"""Client-only Simple Voice Chat protocols 20/21; no server admin bridge.

Wire contract: henkelmax/simple-voice-chat eca3c816 (1.21.11), protocol20
cross-checked against the installed official 2.6.27 jar. Secrets stay in memory.
"""
import base64
import ctypes as C
import json
import ctypes.util
import os
import socket
import struct
import threading
import time
from uuid import UUID
from .voice import HttpVoiceTransport, PCM, UtteranceBuffer, VoiceUnavailable, normalize_pcm


def varint(value):
    if not 0 <= value <= 65535:
        raise ValueError('Invalid packet length')
    out = bytearray()
    while value > 127:
        out.append((value & 127) | 128)
        value >>= 7
    return bytes(out + bytes([value]))


def read_array(data, offset=0):
    size = 0
    for i in range(3):
        b = data[offset + i]
        size |= (b & 127) << (7 * i)
        if not b & 128:
            start = offset + i + 1
            if size > 65535 or start + size > len(data):
                raise ValueError('Invalid packet size')
            return data[start:start + size], start + size
    raise ValueError('Invalid VarInt')


class Opus:
    """Bounded mono48kHz codec via the installed libopus C ABI."""
    def __init__(self, encode=False):
        library = ctypes.util.find_library('opus') or '/opt/homebrew/lib/libopus.dylib'
        self.lib = C.CDLL(library)
        self.encode_mode = encode
        create = self.lib.opus_encoder_create if encode else self.lib.opus_decoder_create
        create.restype = C.c_void_p
        create.argtypes = [C.c_int, C.c_int] + ([C.c_int] if encode else []) + [C.POINTER(C.c_int)]
        error = C.c_int()
        self.state = create(48000, 1, *([2048] if encode else []), C.byref(error))
        if error.value or not self.state:
            raise VoiceUnavailable('Opus initialization failed')
        self.lib.opus_encode.argtypes = [C.c_void_p, C.c_void_p, C.c_int, C.c_void_p, C.c_int]
        self.lib.opus_decode.argtypes = [C.c_void_p, C.c_void_p, C.c_int, C.c_void_p, C.c_int, C.c_int]
        self.lib.opus_encoder_destroy.argtypes = self.lib.opus_decoder_destroy.argtypes = [C.c_void_p]

    def encode(self, pcm):
        if len(pcm) != 1920:
            raise ValueError('Opus needs a 20ms frame')
        out = C.create_string_buffer(1275)
        n = self.lib.opus_encode(self.state, C.create_string_buffer(pcm), 960, out, 1275)
        if n < 0:
            raise VoiceUnavailable('Opus encoding failed')
        return out.raw[:n]

    def decode(self, packet):
        if not 0 < len(packet) <= 1275:
            raise ValueError('Invalid Opus payload')
        out = C.create_string_buffer(11520)
        n = self.lib.opus_decode(self.state, C.create_string_buffer(packet), len(packet), out, 5760, 0)
        if n < 0:
            raise ValueError('Invalid Opus audio')
        return out.raw[:n * 2]

    def close(self):
        if self.state:
            (self.lib.opus_encoder_destroy if self.encode_mode else self.lib.opus_decoder_destroy)(self.state)
            self.state = None


class Wire:
    def __init__(self, secret, identity):
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        if len(secret) != 16:
            raise ValueError('Invalid SVC secret')
        self.aes = AESGCM(secret)
        self.identity = UUID(identity).bytes

    def client_packet(self, plain):
        nonce = os.urandom(12)
        payload = nonce + self.aes.encrypt(nonce, plain, None)
        return b'\xff' + self.identity + varint(len(payload)) + payload

    def server_packet(self, data):
        if len(data) > 65535 or data[:1] != b'\xff':
            raise ValueError('Invalid SVC datagram')
        payload, end = read_array(data, 1)
        if end != len(data) or len(payload) < 29:
            raise ValueError('Invalid SVC ciphertext')
        return self.aes.decrypt(payload[:12], payload[12:], None)


class SvcClientTransport(HttpVoiceTransport):
    def __init__(self, url, token, *, allow_send=False):
        super().__init__(url, token)
        self.allow_send = allow_send
        self._allowed = frozenset()
        self._run = None
        self._state_binding = None
        self._audio_lock = threading.Lock()
        self._send_lock = threading.Lock()

    def set_allowed_speakers(self, speakers):
        allowed = None if speakers is None else frozenset(str(UUID(p)) for p in speakers)
        with self._audio_lock:
            if self._allowed != allowed:
                self._allowed = allowed
                self._buffer = UtteranceBuffer()

    def bind(self, player_uuid, session_id):
        with self._lifecycle:
            self.close()
            self.session_id = session_id
            config = self._request('/voice/session')
            if config.get('session_id') != session_id or config.get('bot_uuid') != str(UUID(player_uuid)):
                self.session_id = None
                raise VoiceUnavailable('Voice configuration does not match game session')
            generation = str(UUID(config['generation']))
            protocol = config.get('protocol')
            if protocol not in (20, 21):
                raise VoiceUnavailable('Unsupported SVC protocol')
            key = base64.b64decode(config['secret'], validate=True)
            wire = Wire(key, config['connection_id'] if protocol == 21 else player_uuid)
            host, port = config['host'], config['port']
            if not isinstance(host, str) or not host or not isinstance(port, int) or not 1 <= port <= 65535:
                raise VoiceUnavailable('Invalid SVC endpoint')
            addresses = socket.getaddrinfo(host, port, type=socket.SOCK_DGRAM)
            family, kind, proto, _, address = addresses[0]
            sock = socket.socket(family, kind, proto)
            sock.connect(address)  # Kernel rejects datagrams from other endpoints.
            sock.settimeout(.2)
            run = {'socket': sock, 'wire': wire, 'stop': threading.Event(), 'ready': threading.Event(),
                   'protocol': protocol, 'auth': b'\x05' + (UUID(player_uuid).bytes + key if protocol == 20 else b''),
                   'keep_alive': min(120, max(2, config.get('keep_alive', 1000) / 100)), 'last': time.monotonic(),
                   'config_key': (config['secret'], config.get('connection_id'), config.get('generation')), 'checked': time.monotonic()}
            self._run = run
            self._state_binding = (session_id, generation)
            try:
                self._sync_state(self._state_binding, muted=not self.allow_send, disabled=False)
            except Exception:
                self.close()
                raise
            run['thread'] = threading.Thread(target=self._receive, args=(run,), daemon=True, name='SVCClient')
            run['thread'].start()
            if not run['ready'].wait(6) or self._run is not run or run['stop'].is_set():
                self.close()
                raise VoiceUnavailable('SVC UDP handshake unavailable')
            try:
                self._sync_state(self._state_binding, muted=not self.allow_send, disabled=False)
            except Exception:
                self.close()
                raise
            self.connected = True
            return {'status': 'connected', 'session_id': session_id, 'protocol': protocol}

    def _sync_state(self, binding, *, muted, disabled):
        session, generation = binding
        result = self._request('/voice/state', 'POST',
            json.dumps({'muted': muted, 'disabled': disabled}).encode(),
            {'Content-Type': 'application/json', 'X-Persona-Session': session, 'X-Voice-Generation': generation})
        if result.get('status') != 'updated':
            raise VoiceUnavailable('Voice state synchronization refused')

    def _send(self, run, plain):
        if self._run is not run or run['stop'].is_set():
            raise VoiceUnavailable('Voice session closed')
        run['socket'].send(run['wire'].client_packet(plain))

    def _receive(self, run):
        decoders, sequences = {}, {}
        handshake, next_retry = run['auth'], 0
        try:
            while not run['stop'].is_set():
                now = time.monotonic()
                if not run['ready'].is_set() and now >= next_retry:
                    self._send(run, handshake)
                    next_retry = now + 1
                if run['ready'].is_set() and now - run['last'] > run['keep_alive']:
                    break
                try:
                    packet = run['wire'].server_packet(run['socket'].recv(65535))
                except socket.timeout:
                    continue
                except (ValueError, IndexError):
                    continue
                except Exception as exc:
                    from cryptography.exceptions import InvalidTag
                    if isinstance(exc, InvalidTag):
                        continue
                    raise
                kind = packet[0]
                if kind == 6:
                    if len(packet) != (17 if run['protocol'] == 21 else 1):
                        continue
                    handshake = b'\x09' + packet[1:]
                    self._send(run, handshake)
                elif kind == 10 and handshake[:1] == b'\x09':
                    run['ready'].set()
                    run['last'] = now
                elif kind in (7, 8):
                    self._send(run, packet)
                    run['last'] = now
                elif kind == 2 and run['ready'].is_set():
                    # Only entity/proximity audio, not anonymous location/group broadcasts.
                    if len(packet) < 43:
                        continue
                    speaker = str(UUID(bytes=packet[17:33]))
                    with self._audio_lock:
                        if self._allowed is not None and speaker not in self._allowed:
                            continue
                        opus, offset = read_array(packet, 33)
                        if offset + 13 > len(packet):
                            continue
                        seq = struct.unpack_from('>q', packet, offset)[0]
                        channel = packet[1:17]
                        identity = (speaker, channel)
                        if seq <= sequences.get(identity, -1):
                            continue
                        if identity not in sequences and len(sequences) >= 128:
                            continue
                        sequences[identity] = seq
                        if not opus:
                            decoder = decoders.pop(identity, None)
                            if decoder:
                                decoder.close()
                            continue
                        if identity not in decoders:
                            if len(decoders) >= 16:
                                continue
                            decoders[identity] = Opus()
                        self._buffer.add(speaker, decoders[identity].decode(opus), now=now)
        except (OSError, VoiceUnavailable, ValueError, IndexError):
            pass
        finally:
            run['stop'].set()
            if self._run is run:
                self.connected = False
            for decoder in decoders.values():
                decoder.close()

    def poll_utterances(self):
        if not self.connected:
            raise VoiceUnavailable('SVC UDP disconnected')
        run = self._run
        if run is None:
            raise VoiceUnavailable('SVC UDP disconnected')
        if time.monotonic() - run['checked'] > 3:
            try:
                config = self._request('/voice/session')
            except VoiceUnavailable:
                self.close()
                raise
            if config.get('session_id') != self.session_id or (config.get('secret'), config.get('connection_id'), config.get('generation')) != run['config_key']:
                self.close()
                raise VoiceUnavailable('SVC credentials changed')
            run['checked'] = time.monotonic()
        with self._audio_lock:
            return self._buffer.flush(now=time.monotonic())

    def send_audio(self, pcm):
        if not self.allow_send:
            raise VoiceUnavailable('Voice transmission is disabled')
        with self._send_lock:
            run = self._run
            if not self.connected or run is None:
                raise VoiceUnavailable('SVC UDP disconnected')
            with self._lifecycle:
                if self._run is not run or self._state_binding is None:
                    raise VoiceUnavailable('Voice session changed')
                self._sync_state(self._state_binding, muted=False, disabled=False)
            audio = normalize_pcm(pcm).data
            encoder = Opus(True)
            start = time.monotonic()
            try:
                # Monotonic sequence across utterances, like the actual microphone client.
                for index, offset in enumerate(range(0, len(audio), 1920)):
                    if run['stop'].wait(max(0, start + index * .02 - time.monotonic())):
                        raise VoiceUnavailable('Voice session closed')
                    encoded = encoder.encode(audio[offset:offset + 1920].ljust(1920, b'\x00'))
                    seq = run.get('sequence', 0)
                    self._send(run, b'\x01' + varint(len(encoded)) + encoded + struct.pack('>q?', seq, False))
                    run['sequence'] = seq + 1
                self._send(run, b'\x01\x00' + struct.pack('>q?', run['sequence'], False))
                run['sequence'] += 1
            finally:
                encoder.close()
            return {'status': 'sent', 'samples': len(audio) // 2}

    def close(self):
        with self._lifecycle:
            run, self._run = self._run, None
            binding, self._state_binding = self._state_binding, None
            self.connected = False
            self.session_id = None
            if run:
                run['stop'].set()
                run['socket'].close()
                if run.get('thread'):
                    run['thread'].join(timeout=1)
            if binding is not None:
                try:
                    # Cached identity only: a late close must not disable a replacement session.
                    self._sync_state(binding, muted=True, disabled=True)
                except VoiceUnavailable:
                    pass  # Rejection is expected after a generation/session change.
            with self._audio_lock:
                self._buffer = UtteranceBuffer()
