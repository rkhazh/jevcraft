"""Minecraft voice boundary. No microphone capture or desktop playback.

A transport must bind to the same Minecraft player/session as the game body.
Transport acceptance is NOT proof that another player heard the speech.
"""
from dataclasses import dataclass
import audioop


class VoiceUnavailable(RuntimeError):
    pass


@dataclass(frozen=True)
class PCM:
    data: bytes
    sample_rate: int = 48000
    channels: int = 1


def normalize_pcm(pcm, sample_rate=48000):
    """Validate bounded signed 16-bit little-endian PCM; downmix and resample."""
    if (not isinstance(pcm, PCM) or not isinstance(pcm.data, bytes)
            or type(pcm.sample_rate) is not int or not 8000 <= pcm.sample_rate <= 192000
            or pcm.channels not in (1, 2) or not pcm.data
            or len(pcm.data) % (2 * pcm.channels)
            or len(pcm.data) > pcm.sample_rate * pcm.channels * 2 * 30):
        raise ValueError('Expected nonempty PCM16 mono/stereo audio of at most 30 seconds')
    data = pcm.data
    if pcm.channels == 2:
        data = audioop.tomono(data, 2, 0.5, 0.5)
    if pcm.sample_rate != sample_rate:
        data, _ = audioop.ratecv(data, 2, 1, pcm.sample_rate, sample_rate, None)
    return PCM(data, sample_rate, 1)


def nettyan_synthesize(text, emotion):
    """AI Persona Lab's Piper Gradio wire format, without the NetTyan app."""
    import os
    import wave
    from gradio_client import Client
    endpoint=os.environ.get('TOLIK_TTS_URL','http://127.0.0.1:22231/')
    client=Client(endpoint,verbose=False,httpx_kwargs={'timeout':30})
    result=client.predict(text=text,normalize=False,reference_id='',reference_audio=None,
        reference_text='',max_new_tokens=500,chunk_length=200,top_p=.7,
        repetition_penalty=1.2,temperature=.4,seed=0,use_memory_cache='off',api_name='/partial')
    with wave.open(result[0],'rb') as stream:
        if stream.getsampwidth()!=2:raise VoiceUnavailable('Piper returned non-PCM16 audio')
        return normalize_pcm(PCM(stream.readframes(stream.getnframes()),stream.getframerate(),stream.getnchannels()))


def nettyan_transcribe(pcm):
    """Local Parakeet HTTP STT; no desktop device or NetTyan import."""
    import io,os,wave,requests
    buffer=io.BytesIO()
    with wave.open(buffer,'wb') as stream:
        stream.setnchannels(pcm.channels);stream.setsampwidth(2)
        stream.setframerate(pcm.sample_rate);stream.writeframes(pcm.data)
    response=requests.post(os.environ.get('TOLIK_STT_URL','http://127.0.0.1:22233/v1/audio/transcriptions'),
        files={'file':('audio.wav',buffer.getvalue(),'audio/wav')},data={'language':'ru'},timeout=30)
    response.raise_for_status()
    return response.json().get('text','').strip()


def roster_voice_names(snapshot, session_id, now, max_age=5):
    """Resolve only fresh same-session server-roster identities; no UUID guessing."""
    import math
    import re
    from uuid import UUID
    observed=snapshot.get('observed_at')
    if (snapshot.get('session_id')!=session_id or snapshot.get('connected') is not True
            or type(observed) not in (int,float) or not math.isfinite(observed)
            or not -1<=now-observed<=max_age):
        return {}
    entries=snapshot.get('player_identities',[])
    if not isinstance(entries,list) or len(entries)>128:
        return {}
    pairs=[]
    for entry in entries:
        if not isinstance(entry,dict):continue
        name=entry.get('name')
        try:
            uuid=str(UUID(entry.get('uuid')))
        except (ValueError,TypeError,AttributeError):
            continue
        if isinstance(name,str) and re.fullmatch(r'[A-Za-z0-9_]{1,16}',name):
            pairs.append((uuid,name))
    # Even one conflicting alias invalidates both identities, not last-write-wins.
    return {uuid:name for uuid,name in pairs
            if len({n for u,n in pairs if u==uuid})==1 and len({u for u,n in pairs if n==name})==1}


class VoiceAdapter:
    def __init__(self, *, transport=None, synthesize=nettyan_synthesize,
                 transcribe=nettyan_transcribe, self_player=None):
        self.transport = transport
        self.synthesize = synthesize
        self.transcribe = transcribe
        self.self_player = self_player
        self.allowed_speakers = None

    def set_allowed_speakers(self, allowed):
        if allowed is not None and not isinstance(allowed,frozenset):
            raise ValueError('Voice speaker filter must be a frozenset or None')
        setter=getattr(self.transport,'set_allowed_speakers',None)
        if allowed is not None and not callable(setter):
            raise VoiceUnavailable('Transport cannot filter incoming speakers')
        if callable(setter):setter(allowed)
        self.allowed_speakers=allowed

    @property
    def available(self):
        return self.transport is not None and self.transport.connected

    def status(self):
        return {'state': 'connected' if self.available else 'unavailable',
                'source': 'minecraft_voice',
                'reason': None if self.available else 'No connected Minecraft voice transport'}

    def _require_transport(self):
        if not self.available:
            raise VoiceUnavailable('No connected Minecraft voice transport')

    def speak(self, text, emotion='neutral'):
        self._require_transport()
        if getattr(self.transport,'allow_send',True) is False:
            raise VoiceUnavailable('Outgoing client voice requires explicit enablement')
        if not isinstance(text, str) or not text.strip() or len(text) > 300:
            raise ValueError('Speech must contain 1 to 300 characters')
        session = self.transport.session_id
        audio = normalize_pcm(self.synthesize(text, emotion))
        self._require_transport()
        if self.transport.session_id != session:
            raise VoiceUnavailable('Minecraft voice session changed during synthesis')
        result = self.transport.send_audio(audio)
        if not isinstance(result, dict) or result.get('status') not in {'accepted','sent'}:
            raise VoiceUnavailable('Minecraft voice transport did not accept audio')
        return {**result, 'heard_by_player': False}

    def receive(self, player, pcm, *, session_id):
        self._require_transport()
        if session_id != self.transport.session_id:
            raise ValueError('Audio belongs to a stale Minecraft session')
        if not isinstance(player, str) or not player or len(player) > 64:
            raise ValueError('Missing Minecraft speaker identity')
        if player == self.self_player or (self.allowed_speakers is not None and player not in self.allowed_speakers):
            return None
        text = self.transcribe(normalize_pcm(pcm, 16000))
        self._require_transport()
        if session_id != self.transport.session_id:
            raise VoiceUnavailable('Minecraft voice session changed during transcription')
        if not isinstance(text, str) or not text.strip():
            return None
        return {'source': 'minecraft_voice', 'session_id': session_id,
                'player': player, 'text': text.strip()[:2000]}


class UtteranceBuffer:
    """Bound per-speaker audio; finalize on a 500 ms packet gap or 10 s speech."""
    def __init__(self):
        self._speakers = {}

    def add(self, player, data, *, now):
        if not isinstance(data, bytes) or not data or len(data) > 11520 or len(data) % 2:
            raise ValueError('Malformed PCM voice frame')
        if player not in self._speakers and len(self._speakers) >= 32:
            return
        audio, _ = self._speakers.get(player, (bytearray(), now))
        if len(audio) + len(data) <= 48000 * 2 * 10:
            audio.extend(data)
        self._speakers[player] = (audio, now)

    def flush(self, *, now):
        complete = []
        for player, (audio, last) in list(self._speakers.items()):
            if now - last >= .5 or len(audio) >= 48000 * 2 * 10 - 11520:
                complete.append((player, PCM(bytes(audio))))
                del self._speakers[player]
        return complete


class HttpVoiceTransport:
    """Client for integrations/minecraft-voice's loopback SVC Fabric bridge."""
    def __init__(self, url, token):
        from urllib.parse import urlsplit
        p = urlsplit(url)
        if (p.scheme != 'http' or p.hostname not in ('127.0.0.1', 'localhost', '::1')
                or p.username or p.password or p.query or p.fragment or p.path not in ('', '/')
                or not isinstance(token, str) or len(token) < 32):
            raise ValueError('Voice bridge requires a loopback HTTP URL and >=32 character token')
        import threading
        self._lifecycle = threading.RLock()
        self.url = url.rstrip('/')
        self._token = token
        self.connected = False
        self.session_id = None
        self._buffer = UtteranceBuffer()
        self.allowed_speakers = None

    def set_allowed_speakers(self, allowed):
        if allowed is not None and not isinstance(allowed,frozenset):
            raise ValueError('Invalid voice speaker filter')
        if allowed != self.allowed_speakers:
            self._buffer = UtteranceBuffer()
        self.allowed_speakers = allowed

    def _request(self, path, method='GET', data=None, headers=None):
        import json
        import urllib.request
        # Disable environment proxies and redirects so the local bearer token stays local.
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *args, **kwargs):
                return None
        request = urllib.request.Request(self.url + path, data=data, method=method, headers={
            'Authorization': 'Bearer ' + self._token,
            'X-Voice-Session': self.session_id or '',
            **(headers or {}),
        })
        try:
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
            with opener.open(request, timeout=40 if method == 'POST' and path == '/audio' else 5) as response:
                raw = response.read(2_000_001)
                if len(raw) > 2_000_000:
                    raise ValueError('Voice response too large')
                return json.loads(raw)
        except Exception as exc:
            self.connected = False
            raise VoiceUnavailable('Minecraft voice bridge request failed') from exc

    def bind(self, player_uuid, session_id):
        with self._lifecycle:
            return self._bind(player_uuid, session_id)

    def _bind(self, player_uuid, session_id):
        import re
        from uuid import UUID
        player_uuid = str(UUID(player_uuid))
        if not isinstance(session_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', session_id):
            raise ValueError('Invalid voice session id')
        self.session_id = session_id
        result = self._request('/bind', 'POST', b'', {'X-Player-UUID': player_uuid})
        self.connected = result.get('status') == 'connected' and result.get('session_id') == session_id
        if not self.connected:
            raise VoiceUnavailable('Minecraft voice bridge did not bind this session')
        self._buffer = UtteranceBuffer()
        return result

    def close(self):
        with self._lifecycle:
            self._close()

    def _close(self):
        try:
            if self.session_id is not None:
                self._request('/bind', 'DELETE')
        finally:
            self.connected = False
            self.session_id = None
            self._buffer = UtteranceBuffer()

    def send_audio(self, pcm):
        if not self.connected:
            raise VoiceUnavailable('Minecraft voice transport disconnected')
        audio = normalize_pcm(pcm)
        return self._request('/audio', 'POST', audio.data, {'Content-Type': 'application/octet-stream'})

    def poll_utterances(self):
        import base64
        import time
        if not self.connected:
            raise VoiceUnavailable('Minecraft voice transport disconnected')
        result = self._request('/audio')
        if result.get('session_id') != self.session_id:
            self.connected = False
            raise VoiceUnavailable('Minecraft voice session changed')
        now = time.monotonic()
        for frame in result.get('frames', []):
            if self.allowed_speakers is not None and frame.get('player') not in self.allowed_speakers:
                continue
            self._buffer.add(frame['player'], base64.b64decode(frame['pcm'], validate=True), now=now)
        return self._buffer.flush(now=now)


def runtime_voice_event(event, *, speaker_name=None):
    """Preserve provenance while adapting to NetTyan's existing event check."""
    return {**event, 'type': 'voice', 'user': speaker_name if speaker_name is not None else event['player'],
            'msg': event['text'], 'env': 'minecraft'}
