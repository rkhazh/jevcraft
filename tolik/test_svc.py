import base64
import json
import math
import os
import socket
import struct
import threading
import time
import unittest
from uuid import uuid4
from tolik.svc_client import SvcClientTransport, Opus, Wire, varint, read_array
from tolik.voice import PCM, VoiceUnavailable
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


class ClientTests(unittest.TestCase):
    def test_opus_real_codec_and_bounds(self):
        enc, dec = Opus(True), Opus()
        pcm = struct.pack('<960h', *(int(12000 * math.sin(i / 10)) for i in range(960)))
        try:
            decoded = dec.decode(enc.encode(pcm))
            self.assertEqual(len(decoded), 1920)
            self.assertTrue(any(decoded))
            with self.assertRaises(ValueError):
                dec.decode(b'x' * 1276)
        finally:
            enc.close(); dec.close()

    def test_wire_authentication_and_length(self):
        key = os.urandom(16); wire = Wire(key, str(uuid4()))
        raw = wire.client_packet(b'\x08')
        encrypted, end = read_array(raw, 17)
        self.assertEqual(end, len(raw))
        self.assertEqual(AESGCM(key).decrypt(encrypted[:12], encrypted[12:], None), b'\x08')
        reply = b'\xff' + varint(len(encrypted)) + encrypted
        self.assertEqual(wire.server_packet(reply), b'\x08')
        with self.assertRaises(Exception):
            wire.server_packet(reply[:-1] + bytes([reply[-1] ^ 1]))

    def test_close_uses_cached_generation_and_never_new_mutable_session(self):
        client = SvcClientTransport('http://127.0.0.1:8766', 'x' * 32)
        generation = str(uuid4())
        client._state_binding = ('old-session', generation)
        client.session_id = 'replacement-session'
        calls = []
        def request(path, method, data, headers):
            calls.append((path, json.loads(data), headers))
            return {'status': 'updated'}
        client._request = request
        client.close()
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][1], {'muted': True, 'disabled': True})
        self.assertEqual(calls[0][2]['X-Persona-Session'], 'old-session')
        self.assertEqual(calls[0][2]['X-Voice-Generation'], generation)
        client.close()
        self.assertEqual(len(calls), 1)

    def test_real_udp_handshake_both_protocols_and_receive_acl(self):
        for protocol in (20, 21):
            with self.subTest(protocol=protocol):
                self.exchange(protocol)

    def exchange(self, protocol):
        key, player, sender = os.urandom(16), str(uuid4()), str(uuid4())
        server = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        server.bind(('127.0.0.1', 0)); server.settimeout(2)
        stop = threading.Event(); sent = threading.Event(); outgoing = threading.Event(); errors = []
        config = dict(session_id='test', generation=str(uuid4()), bot_uuid=player, protocol=protocol, secret=base64.b64encode(key).decode(),
                      connection_id=str(uuid4()) if protocol == 21 else None, host='127.0.0.1', port=server.getsockname()[1], keep_alive=1000)
        client = SvcClientTransport('http://127.0.0.1:8766', 'x' * 32)
        state_calls = []
        def request(path, method='GET', data=None, headers=None):
            if path == '/voice/state':
                value = json.loads(data)
                self.assertEqual(headers['X-Persona-Session'], 'test')
                if headers['X-Voice-Generation'] != config['generation']:
                    raise VoiceUnavailable('stale generation')
                state_calls.append({**value, 'generation': headers['X-Voice-Generation']})
                return {'status': 'updated'}
            return dict(config)
        client._request = request
        client.set_allowed_speakers(frozenset([sender]))
        nonce = os.urandom(16) if protocol == 21 else b''
        def reply(addr, plain):
            iv = os.urandom(12); payload = iv + AESGCM(key).encrypt(iv, plain, None)
            server.sendto(b'\xff' + varint(len(payload)) + payload, addr)
        def serve():
            try:
                while not stop.is_set():
                    raw, addr = server.recvfrom(65535)
                    encrypted, _ = read_array(raw, 17)
                    packet = AESGCM(key).decrypt(encrypted[:12], encrypted[12:], None)
                    if packet[0] == 5:
                        self.assertEqual(packet[1:], b'' if protocol == 21 else __import__('uuid').UUID(player).bytes + key)
                        reply(addr, b'\x06' + nonce)
                    elif packet[0] == 1:
                        encoded, end = read_array(packet, 1)
                        if encoded:
                            decoder = Opus()
                            try: self.assertEqual(len(decoder.decode(encoded)), 1920)
                            finally: decoder.close()
                        else: outgoing.set()
                    elif packet[0] == 9:
                        self.assertEqual(packet[1:], nonce)
                        reply(addr, b'\x0a')
                        encoder = Opus(True)
                        try:
                            opus = encoder.encode(struct.pack('<960h', *([8000] * 960)))
                            # Untrusted sender first: must not decode/buffer it.
                            for source in (str(uuid4()), sender):
                                packet = b'\x02' + uuid4().bytes + __import__('uuid').UUID(source).bytes + varint(len(opus)) + opus + struct.pack('>qfB', 1, 48., 0)
                                reply(addr, packet)
                        finally:
                            encoder.close()
                        sent.set()
            except socket.timeout:
                pass
            except Exception as exc:
                if not stop.is_set(): errors.append(exc)
        thread = threading.Thread(target=serve, daemon=True); thread.start()
        try:
            client.bind(player, 'test')
            self.assertTrue(sent.wait(2))
            self.assertEqual([(s['muted'],s['disabled']) for s in state_calls], [(True,False),(True,False)])
            time.sleep(.65)
            # Reapplying identical roster must retain buffered speech.
            client.set_allowed_speakers(frozenset([sender]))
            utterances = client.poll_utterances()
            self.assertEqual([u[0] for u in utterances], [sender])
            self.assertEqual(len(utterances[0][1].data), 1920)
            with self.assertRaises(VoiceUnavailable): client.send_audio(PCM(b'\x00' * 1920))
            client.allow_send = True
            client.send_audio(PCM(struct.pack('<960h', *([8000] * 960))))
            self.assertTrue(outgoing.wait(2))
            old_generation = config['generation']
            config['generation'] = str(uuid4())
            config['secret'] = base64.b64encode(os.urandom(16)).decode()
            client._run['checked'] = 0
            with self.assertRaises(VoiceUnavailable): client.poll_utterances()
            self.assertFalse(client.connected)
            self.assertTrue(all(s['generation'] == old_generation for s in state_calls))
            self.assertFalse(any(s['disabled'] for s in state_calls))
        finally:
            client.close(); stop.set(); server.close(); thread.join(2)
        self.assertEqual(errors, [])

if __name__ == '__main__': unittest.main()
