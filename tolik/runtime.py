"""Hermes plans at milestones; native JevCraft keeps acting during inference."""
import copy
import json
import time
import unicodedata
from uuid import uuid4


TERMINAL={'complete','completed','failed','blocked','cancelled','expired','complete_unverified'}


class Runtime:
    def __init__(self,body,planner,memory,profile,*,clock=time.time,max_calls=24,voice=None,vision_directory=None,operators=None):
        self.body,self.planner,self.memory,self.profile=body,planner,memory,profile
        self.clock,self.max_calls,self.voice=clock,max_calls,voice
        self.session=None;self.cursor=0;self.revision=0;self.messages=[]
        self.dirty=True;self.next_plan=0;self.calls=0;self.inflight=None
        self.uncertain=None;self.owned_goal=None;self.feedback=[];self.closed=False
        self.last_snapshot=None;self.inspection=None
        self.vision_directory=vision_directory
        self.pending_capture=None
        self.reconcile_at=0
        self.operators=dict(operators or {})

    def operator_instruction(self,event):
        expected=self.operators.get(event.get('user'))
        field='speaker_uuid' if event.get('type')=='voice' else 'sender_uuid'
        return bool(expected and event.get(field)==expected)

    def record(self,kind,**data):
        self.memory.record(dict(type=kind,observed_at=self.clock(),session_id=self.session,**data))

    def tick(self):
        if self.closed:return
        state=self.body.snapshot();self.last_snapshot=state
        if state.get('connected') is not True:
            self.planner.close();self.inflight=None
            return
        if abs(self.clock()-state.get('observed_at',0))>5:raise RuntimeError('Stale body observation')
        if self.session!=state['session_id']:
            if self.session:self.planner.close()
            self.session=state['session_id'];self.cursor=0;self.revision+=1
            self.inflight=None;self.messages=[];self.uncertain=None;self.owned_goal=None;self.dirty=True
        if self.voice:
            for event in self.voice.poll(state):
                if event.get('session_id')!=self.session:continue
                event=dict(event,operator_instruction=self.operator_instruction(event))
                self.memory.record(dict(event,world_id=state['world_id']))
                self.messages.append(event);self.revision+=1;self.dirty=True
            for report in self.voice.drain_reports():self.record('voice_report',receipt=report)
        for _ in range(16):
            packet=self.body.events(self.cursor)
            for event in packet.get('events',[]):
                if event.get('session_id')!=self.session:continue
                identifier=event.get('event_id')
                if not identifier:continue
                event=dict(event,world_id=state['world_id'])
                if event.get('type') in {'chat','voice'}:
                    event['operator_instruction']=self.operator_instruction(event)
                event['verified_completion']=event.get('status') in {'complete','completed'} and event.get('verified') is True
                inserted=self.memory.record(event)
                if not inserted:continue
                if event.get('type') in {'chat','voice'} and event.get('user')!=self.profile['persona_id']:
                    self.messages.append(event);self.messages=self.messages[-64:]
                    self.revision+=1;self.dirty=True
                if event.get('type')=='native_feedback':
                    self.feedback.append({'native':event.get('message')});self.dirty=True
                if event.get('status') in TERMINAL:
                    self.dirty=True
                    if self.uncertain and event.get('goal_id')==self.uncertain['goal_id']:self.uncertain=None
                    if event.get('goal_id')==self.owned_goal:self.owned_goal=None
            self.cursor=packet.get('cursor',self.cursor)
            if not packet.get('has_more'):break
        if self.uncertain and (state.get('active_goal_id')==self.uncertain['goal_id'] or (self.uncertain['expires_at'] is not None and self.clock()>=self.uncertain['expires_at'])):
            self.uncertain=None;self.dirty=True
        if self.uncertain and self.uncertain['expires_at'] is None and self.clock()>=self.reconcile_at:
            # Reconcile an ambiguous send using the exact same idempotency key.
            # An unreceived proposal eventually fails freshness; an accepted one
            # returns its stored receipt without starting a second task.
            self.reconcile_at=self.clock()+5
            try:
                receipt=self.body.submit(self.uncertain)
                self.record('goal_reconciled',goal_id=self.uncertain['goal_id'],receipt=receipt)
                self.uncertain=None;self.dirty=True
                if receipt.get('status')!='accepted':
                    self.owned_goal=None;self.feedback.append({'admission':receipt})
            except Exception as error:
                self.record('goal_reconcile_pending',error=type(error).__name__)
        if self.inflight:
            try:result=self.planner.poll()
            except Exception as error:
                self.feedback=[{'planner_error':type(error).__name__}]
                self.record('planner_error',error=type(error).__name__)
                self.inflight=None;self.next_plan=self.clock()+10;self.dirty=False
                return
            if result is not None:
                original=self.inflight;self.inflight=None
                self.record('planner_result',plan=result)
                if original['session']!=self.session or original['revision']!=self.revision:
                    self.record('plan_withheld',reason='new_message_or_session');self.dirty=True
                else:
                    self.apply(result,original['state'],state)
                    self.messages=[]
        if not self.inflight and not self.uncertain and (self.max_calls==0 or self.calls<self.max_calls) and (self.dirty or self.clock()>=self.next_plan):
            context=dict(profile=self.profile,observation=state,messages=copy.deepcopy(self.messages),
                memory=self.memory.context(state['world_id'],18),feedback=self.feedback,
                inspection=self.inspection,verified_results_only=True,operator_players=list(self.operators))
            if self.vision_directory:
                try:
                    from .vision import validate_capture,save_capture
                    packet=self.pending_capture or self.body.vision(self.session)
                    self.pending_capture=None
                    frame=validate_capture(packet,self.body.snapshot(),self.clock())
                    context['image_path']=save_capture(frame,self.vision_directory)
                    context['image_metadata']=frame['metadata']
                except Exception as error:
                    context['vision_status']={'available':False,'reason':type(error).__name__}
            self.planner.start(context);self.calls+=1;self.dirty=False
            self.inflight=dict(session=self.session,revision=self.revision,state=copy.deepcopy(state))
            self.record('planner_started',call=self.calls,message_ids=[m['event_id'] for m in self.messages])

    def apply(self,plan,original,current):
        self.feedback=[];self.dirty=False
        if not isinstance(plan,dict) or set(plan)-{'intent','say','goal','inspect','wait_seconds','cancel'}:
            self.feedback=[{'error':'invalid_plan_shape'}];self.next_plan=self.clock()+10;return
        delay=plan.get('wait_seconds',15)
        if type(delay) not in (int,float) or not 1<=delay<=60:delay=15
        self.next_plan=self.clock()+delay
        speech=plan.get('say')
        if speech is not None:
            valid=isinstance(speech,str) and 0<len(speech)<=240 and not speech.lstrip().startswith(('/','!','@')) and not any(unicodedata.category(c) in {'Cc','Cf'} for c in speech)
            if valid:
                receipt=self.body.chat(speech,session_id=self.session)
                self.record('speech',text=speech,receipt=receipt)
                if self.voice and receipt.get('status') in {'sent','accepted'}:
                    try:self.voice.speak(speech)
                    except Exception as error:self.record('voice_error',error=type(error).__name__)
            else:self.feedback.append({'error':'invalid_speech'})
        native=current.get('native_capabilities',{}).get('enabled') is True
        if plan.get('cancel') is True:
            if self.owned_goal and current.get('active_goal_id')==self.owned_goal:
                self.record('cancel',receipt=self.body.cancel(self.owned_goal))
                self.owned_goal=None;self.dirty=True
                if native:current=self.body.snapshot();original=current
        query=plan.get('inspect')
        if query is not None:
            if isinstance(query,dict) and query.get('kind') in {'cells','view'}:
                self.inspection=self.body.inspect(query,self.session)
                packet=self.inspection.pop('frame',None)
                if isinstance(packet,dict):
                    self.pending_capture=packet
                    self.inspection['frame_metadata']={k:v for k,v in packet.items() if k!='image_base64'}
                self.record('inspection',result=self.inspection);self.dirty=True
            else:self.feedback.append({'error':'invalid_inspection'})
        if plan.get('cancel') is True and not native:return
        spec=plan.get('goal')
        if native and plan.get('cancel') is True and spec is None:
            spec={'kind':'native','request':'stop','requester':None}
        if spec is None:return
        if not isinstance(spec,dict) or spec.get('kind') not in {'obtain','craft','move','visit','come','follow','build','edit','native'}:
            self.feedback.append({'error':'invalid_goal'});return
        if original.get('active_goal_id') or current.get('active_goal_id'):
            self.feedback.append({'error':'active_work_preserved'});return
        native=current.get('native_capabilities',{}).get('enabled') is True
        dimension_changed=original.get('dimension')!=current.get('dimension')
        if ((not native and original.get('inventory')!=current.get('inventory')) or
            (dimension_changed and (not native or spec.get('kind') in {'move','edit','build'}))):
            self.feedback.append({'error':'physical_context_changed'});self.dirty=True;return
        fresh=self.body.snapshot()
        if fresh.get('session_id')!=self.session or not fresh.get('connected') or fresh.get('active_goal_id'):
            self.feedback.append({'error':'fresh_admission_changed'});return
        now=self.clock()
        if abs(now-fresh.get('observed_at',0))>5:return
        proposal=dict(schema_version=1,goal_id=str(uuid4()),persona_id=self.profile['persona_id'],
            session_id=self.session,observation_id=fresh['observation_id'],issued_at=now,
            expires_at=None if native else now+120,state='proposed',spec=spec)
        # Save before the network boundary; never assign a new ID after an ambiguous send.
        self.uncertain=proposal;self.owned_goal=proposal['goal_id']
        self.reconcile_at=self.clock()+5
        self.record('goal_proposed',proposal=proposal,intent=plan.get('intent'))
        try:receipt=self.body.submit(proposal)
        except Exception as error:
            self.record('goal_uncertain',goal_id=proposal['goal_id'],error=type(error).__name__);return
        self.uncertain=None
        self.record('goal_ack',goal_id=proposal['goal_id'],receipt=receipt)
        if receipt.get('status')!='accepted':
            self.owned_goal=None;self.feedback.append({'admission':receipt});self.dirty=True

    def close(self):
        if self.closed:return
        self.closed=True;self.planner.close()
        if self.owned_goal:
            try:self.body.cancel(self.owned_goal)
            except Exception:pass
