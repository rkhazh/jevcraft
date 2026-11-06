"""Transport-independent checks: fake external speech engines, real PCM handling."""
import unittest
from tolik.voice import VoiceAdapter, VoiceUnavailable, PCM, normalize_pcm


class Transport:
    connected = True
    session_id = 'session-a'
    def __init__(self):
        self.sent = []
    def send_audio(self, pcm):
        self.sent.append(pcm)
        return {'status': 'accepted'}


class VoiceTests(unittest.TestCase):
    def test_svc_sent_receipt_is_supported_without_claiming_player_heard(self):
        transport=Transport()
        transport.send_audio=lambda pcm:{'status':'sent','samples':len(pcm.data)//2}
        adapter=VoiceAdapter(transport=transport,synthesize=lambda *_:PCM(b'\x01\x00'*960))
        result=adapter.speak('Привет')
        self.assertEqual(result['status'],'sent');self.assertFalse(result['heard_by_player'])
    def test_missing_transport_never_synthesizes_or_reports_delivery(self):
        adapter = VoiceAdapter(synthesize=lambda *_: self.fail('TTS should not run'))
        self.assertEqual(adapter.status()['state'], 'unavailable')
        with self.assertRaises(VoiceUnavailable):
            adapter.speak('hello')

    def test_stereo_pcm_is_downmixed_resampled_and_sent_without_desktop_audio(self):
        transport = Transport()
        adapter = VoiceAdapter(transport=transport, synthesize=lambda *_: PCM(b'\xe8\x03\xe8\x03' * 160, 16000, 2))
        result = adapter.speak('hello', 'happy')
        audio = transport.sent[0]
        self.assertEqual((audio.sample_rate, audio.channels), (48000, 1))
        self.assertEqual(audio.data[:2], b'\xe8\x03')
        self.assertEqual(result['status'], 'accepted')
        self.assertFalse(result['heard_by_player'])

    def test_incoming_audio_keeps_player_identity_and_session(self):
        seen = []
        adapter = VoiceAdapter(transport=Transport(), transcribe=lambda pcm: seen.append(pcm) or 'Привет')
        result = adapter.receive('Alex', PCM(b'\x01\x00' * 960), session_id='session-a')
        self.assertEqual(result, {'source': 'minecraft_voice', 'session_id': 'session-a', 'player': 'Alex', 'text': 'Привет'})
        self.assertEqual(seen[0].sample_rate, 16000)

    def test_stale_session_and_own_audio_are_not_transcribed(self):
        adapter = VoiceAdapter(transport=Transport(), self_player='Skipper', transcribe=lambda _: self.fail('echo/stale STT'))
        with self.assertRaises(ValueError):
            adapter.receive('Alex', PCM(b'\0\0' * 960), session_id='old')
        self.assertIsNone(adapter.receive('Skipper', PCM(b'\0\0' * 960), session_id='session-a'))

    def test_malformed_empty_and_long_audio_rejected(self):
        for pcm in (PCM(b'1'), PCM(b''), PCM(b'\0\0', 0), PCM(b'\0\0', 48000, 3), PCM(b'\0\0' * 48000 * 31)):
            with self.subTest(pcm_length=len(pcm.data)), self.assertRaises(ValueError):
                normalize_pcm(pcm)

    def test_disconnect_and_failed_delivery_not_reported_as_success(self):
        transport = Transport()
        transport.connected = False
        adapter = VoiceAdapter(transport=transport, synthesize=lambda *_: PCM(b'\0\0' * 960))
        with self.assertRaises(VoiceUnavailable):
            adapter.speak('hi')
        transport.connected = True
        transport.send_audio = lambda _: {'status': 'failed'}
        with self.assertRaises(VoiceUnavailable):
            adapter.speak('hi')


if __name__ == '__main__':
    unittest.main()

class HttpVoiceTests(unittest.TestCase):
    def test_bridge_rejects_remote_url_and_short_token(self):
        from tolik.voice import HttpVoiceTransport
        for url, token in [('http://example.org:8768', 'x' * 32), ('http://127.0.0.1:8768', 'x')]:
            with self.assertRaises(ValueError):
                HttpVoiceTransport(url, token)

    def test_packet_assembler_flushes_after_gap_and_bounds_speaker_audio(self):
        from tolik.voice import UtteranceBuffer
        b = UtteranceBuffer()
        b.add('Alex', b'\x01\0' * 960, now=1)
        self.assertEqual(b.flush(now=1.1), [])
        got = b.flush(now=1.6)
        self.assertEqual(got[0][0], 'Alex')
        self.assertEqual(len(got[0][1].data), 1920)
        self.assertEqual(b.flush(now=2), [])
        with self.assertRaises(ValueError):
            b.add('Alex', b'\0' * 100000, now=3)

class VoiceLifecycleTests(unittest.TestCase):
    def test_close_waits_for_binding_and_removes_the_remote_session(self):
        import threading
        from tolik.voice import HttpVoiceTransport
        t = HttpVoiceTransport('http://127.0.0.1:8768', 'x' * 32)
        entered, release, closed = threading.Event(), threading.Event(), threading.Event()
        remote = []
        def request(path, method='GET', data=None, headers=None):
            if method == 'POST':
                entered.set()
                release.wait(2)
                remote.append('session-a')
                return {'status':'connected', 'session_id':'session-a'}
            if method == 'DELETE':
                remote.clear()
                closed.set()
                return {'status':'disconnected'}
        t._request = request
        binder = threading.Thread(target=t.bind,args=('00000000-0000-0000-0000-000000000001','session-a'))
        binder.start()
        self.assertTrue(entered.wait(1))
        closer = threading.Thread(target=t.close)
        closer.start()
        release.set()
        binder.join(2); closer.join(2)
        self.assertFalse(t.connected)
        self.assertIsNone(t.session_id)
        self.assertEqual(remote, [])
        self.assertTrue(closed.is_set())

    def test_close_cleans_remote_binding_after_transport_failure(self):
        from tolik.voice import HttpVoiceTransport
        t = HttpVoiceTransport('http://127.0.0.1:8768', 'x' * 32)
        t.session_id = 'session-a'
        remote = ['session-a']
        def request(*args):
            remote.clear()
            return {'status':'disconnected'}
        t._request = request
        t.close()
        self.assertEqual(remote, [])

class VoiceIdentityTests(unittest.TestCase):
    def test_roster_identity_requires_current_unique_server_uuid_and_name(self):
        from tolik.voice import roster_voice_names
        a='00000000-0000-0000-0000-000000000001'
        b='00000000-0000-0000-0000-000000000002'
        snapshot={'session_id':'s','connected':True,'observed_at':100,'player_identities':[{'uuid':a,'name':'SkipperBot'},{'uuid':b,'name':'Visitor'}]}
        self.assertEqual(roster_voice_names(snapshot,'s',100),{a:'SkipperBot',b:'Visitor'})
        self.assertEqual(roster_voice_names(snapshot,'other',100),{})
        self.assertEqual(roster_voice_names(snapshot,'s',106),{})
        self.assertEqual(roster_voice_names({**snapshot,'connected':False},'s',100),{})
        self.assertEqual(roster_voice_names({**snapshot,'player_identities':[{'uuid':a,'name':'SkipperBot'},{'uuid':b,'name':'SkipperBot'}]},'s',100),{})

    def test_nonadmitted_audio_never_reaches_asr(self):
        transport=Transport()
        transport.set_allowed_speakers=lambda allowed:None
        adapter=VoiceAdapter(transport=transport,transcribe=lambda _: self.fail('Bystander ASR'))
        adapter.set_allowed_speakers(frozenset({'operator-uuid'}))
        self.assertIsNone(adapter.receive('stranger-uuid',PCM(b'bad'),session_id='session-a'))

    def test_http_filter_discards_unknown_before_base64_decode(self):
        from tolik.voice import HttpVoiceTransport
        t=HttpVoiceTransport('http://127.0.0.1:8768','x'*32)
        t.connected=True;t.session_id='s'
        t.set_allowed_speakers(frozenset({'operator-uuid'}))
        t._request=lambda *_:{'session_id':'s','frames':[{'player':'unknown','pcm':'not valid base64'}]}
        self.assertEqual(t.poll_utterances(),[])
