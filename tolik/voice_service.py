"""Optional bounded SVC/ASR/TTS worker; chat and body polling remain responsive."""
from concurrent.futures import Future
import threading
import time
from uuid import uuid4
from .svc_client import SvcClientTransport
from .voice import VoiceAdapter,roster_voice_names


class VoiceService:
    def __init__(self,url,token,config):
        self.transport=SvcClientTransport(url,token,allow_send=config.get('voice_send',False))
        self.adapter=VoiceAdapter(transport=self.transport)
        self.players=frozenset(config.get('voice_players',[]))
        self.lifecycle=threading.RLock()
        self.job=None;self.send_job=None;self.retry_at=0;self.closed=False
        self.reports=[]

    def settle_send(self):
        if self.send_job and self.send_job.done():
            try:self.reports.append(self.send_job.result())
            except Exception as error:self.reports.append({'status':'failed','error':type(error).__name__})
            self.send_job=None

    def drain_reports(self):
        result,self.reports=self.reports,[]
        return result

    def submit(self,fn,*args):
        future=Future()
        def work():
            if not future.set_running_or_notify_cancel():return
            try:future.set_result(fn(*args))
            except BaseException as error:future.set_exception(error)
        threading.Thread(target=work,name='tolik-voice',daemon=True).start()
        return future

    def receive(self,state):
        names=roster_voice_names(state,state['session_id'],time.time())
        allowed=frozenset(u for u,n in names.items() if n in self.players and u!=state.get('bot_uuid'))
        self.adapter.set_allowed_speakers(allowed)
        with self.lifecycle:
            if not allowed or self.closed:return []
            if self.transport.session_id!=state['session_id'] or not self.transport.connected:
                self.adapter.self_player=state['bot_uuid']
                self.transport.bind(state['bot_uuid'],state['session_id'])
        result=[]
        for speaker,pcm in self.transport.poll_utterances():
            if speaker not in allowed:continue
            event=self.adapter.receive(speaker,pcm,session_id=state['session_id'])
            if event and not self.closed:result.append(dict(type='voice',user=names[speaker],msg=event['text'],
                session_id=state['session_id'],observed_at=time.time(),event_id=str(uuid4()),speaker_uuid=speaker))
        return result

    def poll(self,state):
        self.settle_send()
        result=[]
        if self.job and self.job.done():
            try:result=self.job.result() or []
            except Exception:self.retry_at=time.time()+30
            self.job=None
        names=roster_voice_names(state,state['session_id'],time.time())
        result=[e for e in result if e.get('session_id')==state['session_id'] and names.get(e.get('speaker_uuid'))==e.get('user')]
        if not self.closed and not self.job and time.time()>=self.retry_at:
            self.job=self.submit(self.receive,state)
        return result

    def speak(self,text):
        self.settle_send()
        if self.closed or not self.transport.allow_send:return
        # Do not queue unbounded delayed speech behind unavailable ASR/UDP.
        if self.send_job and not self.send_job.done():return
        self.send_job=self.submit(self.adapter.speak,text)

    def close(self):
        with self.lifecycle:
            self.closed=True;self.transport.close()
        for job in (self.job,self.send_job):
            if job:job.cancel()
