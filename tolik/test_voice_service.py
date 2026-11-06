import threading
import time
import unittest
from concurrent.futures import Future
from unittest.mock import Mock,patch
from tolik.voice_service import VoiceService


class VoiceServiceTests(unittest.TestCase):
    def service(self):
        service=VoiceService('http://127.0.0.1:8770','x'*40,{'voice_send':True,'voice_players':['Alex']})
        service.transport=Mock(allow_send=True,connected=False,session_id=None)
        service.transport.poll_utterances.return_value=[]
        service.adapter=Mock()
        return service

    def test_speaking_preserves_finished_incoming_utterance(self):
        service=self.service();service.retry_at=time.time()+10
        event=dict(type='voice',msg='New request',session_id='s',speaker_uuid='uuid',user='Alex')
        incoming=Future();incoming.set_result([event]);service.job=incoming
        service.speak('Response')
        with patch('tolik.voice_service.roster_voice_names',return_value={'uuid':'Alex'}):
            self.assertEqual(service.poll({'session_id':'s'}),[event])
        service.close()

    def test_receive_cannot_bind_after_close(self):
        service=self.service();entered=threading.Event();release=threading.Event()
        service.adapter.set_allowed_speakers.side_effect=lambda _: (entered.set(),release.wait(2))
        with patch('tolik.voice_service.roster_voice_names',return_value={'uuid':'Alex'}):
            worker=threading.Thread(target=service.receive,args=({'session_id':'s','bot_uuid':'self'},))
            worker.start();self.assertTrue(entered.wait(1));service.close();release.set();worker.join(2)
        service.transport.bind.assert_not_called()
    def test_async_speech_failure_is_observable(self):
        service=self.service();service.retry_at=time.time()+10
        job=Future();job.set_exception(RuntimeError('local TTS unavailable'));service.send_job=job
        with patch('tolik.voice_service.roster_voice_names',return_value={}):service.poll({'session_id':'s'})
        self.assertEqual(service.drain_reports(),[{'status':'failed','error':'RuntimeError'}])
        service.close()
