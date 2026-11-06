import unittest
from tolik.test_runtime import Body, Planner, plan
from tolik.runtime import Runtime
from tolik.memory import Memory


class DirectedBody(Body):
    """The bridge changes active work before its next snapshot or event poll."""
    def __init__(self):
        super().__init__()
        self.cancelled=[];self.reject_submit=None;self.accept_then_timeout=False
        self.receipts={}

    def emit(self,**event):
        self.queue.append(dict(session_id=self.state['session_id'],sequence=len(self.queue)+1,
                               observed_at=self.state['observed_at'],**event))

    def finish(self,goal_id,status,identifier=None):
        if self.state['active_goal_id']==goal_id:self.state['active_goal_id']=None
        self.emit(type='goal',event_id=identifier or 'terminal-'+goal_id,status=status,
                  goal_id=goal_id,verified=status=='complete')

    def submit(self,proposal):
        if proposal['goal_id'] in self.receipts:return self.receipts[proposal['goal_id']]
        self.goals.append(proposal)
        if self.reject_submit:return dict(status='rejected',reason=self.reject_submit)
        self.state['active_goal_id']=proposal['goal_id']
        receipt=dict(status='accepted',goal_id=proposal['goal_id'])
        self.receipts[proposal['goal_id']]=receipt
        if proposal['spec'].get('kind')=='native' and proposal['spec'].get('request') in {'stop','status'}:
            self.finish(proposal['goal_id'],'complete_unverified')
        if self.accept_then_timeout:
            self.accept_then_timeout=False
            raise TimeoutError('The server accepted the goal but its response was lost')
        return receipt

    def cancel(self,goal_id):
        self.cancelled.append(goal_id)
        if self.state['active_goal_id']==goal_id:self.finish(goal_id,'cancelled')
        return dict(status='cancelled',goal_id=goal_id)


class Voice:
    def __init__(self,*events):self.events=list(events)
    def poll(self,state):
        events,self.events=self.events,[]
        return events
    def drain_reports(self):return []
    def speak(self,text):pass


class DirectedRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.body=DirectedBody();self.planner=Planner();self.memory=Memory(':memory:')
        self.body.state['native_capabilities']={'enabled':True}
        self.runtime=Runtime(self.body,self.planner,self.memory,{'persona_id':'TolikScheben'},
            clock=lambda:100,operators={'SkipperBot':'operator-uuid'},directed=True)
    def tearDown(self):self.runtime.close();self.memory.close()
    def message(self,text,identifier='order',user='SkipperBot',uuid='operator-uuid',observed_at=100):
        # This community server formats ordinary dialogue. Native slash-command
        # authority is separate from the configured dialogue operator mapping.
        event=dict(type='chat',event_id=identifier,session_id='s',sequence=len(self.body.queue)+1,
                   user=user,sender_uuid=uuid,msg=text,observed_at=observed_at,
                   source='server_formatted',operator_authorized=False)
        self.body.queue.append(event)
        return identifier
    def answer(self,**changes):
        self.runtime.tick();self.planner.answer={**plan(),**changes};self.runtime.tick()
    def test_old_memory_cannot_start_work_or_send_a_promise_after_reconnect(self):
        self.memory.record({'type':'historical_work','record':{'request':'Finish the floor'}})
        self.answer(goal={'kind':'build','request':'Finish old floor','mode':'finish','build_id':'old','schematic':None},say='Иду доделывать пол.')
        self.assertEqual(self.body.goals,[]);self.assertEqual(self.body.speech,[])
    def test_follow_is_dispatched_without_waiting_for_luna_or_native_interpretation(self):
        self.message('Иди за мной');self.runtime.tick()
        self.assertEqual(self.body.goals[0]['spec'],{'kind':'follow','target':'SkipperBot'})
    def test_typo_from_session_still_routes_to_follow(self):
        self.message('ща мной');self.runtime.tick()
        self.assertEqual(self.body.goals[0]['spec']['kind'],'follow')
    def test_stop_interrupts_inference_before_its_old_answer(self):
        self.runtime.tick();self.message('Стой!');self.runtime.tick()
        self.assertTrue(self.planner.closed)
        self.assertEqual(self.body.goals[0]['spec'],{'kind':'native','request':'stop','requester':'SkipperBot'})
    def test_other_player_or_spoofed_uuid_cannot_start_direct_work(self):
        self.message('Иди за мной',uuid='wrong');self.runtime.tick()
        self.assertEqual(self.body.goals,[])
    def test_model_action_requires_latest_real_operator_message_id(self):
        self.message('Сделай пол каменным')
        self.answer(instruction_id='invented',goal={'kind':'obtain','item':'stone','count':9,'deliver':False})
        self.assertEqual(self.body.goals,[])
        self.planner.answer={**plan(), 'instruction_id':'order','goal':{'kind':'obtain','item':'stone','count':9,'deliver':False}}
        self.runtime.tick()
        self.assertEqual(len(self.body.goals),1)
    def test_freeform_native_reinterpretation_is_rejected_but_structured_work_remains(self):
        self.message('Поменяй пол')
        self.answer(instruction_id='order',goal={'kind':'native','request':'Stop following and replace the floor','requester':'SkipperBot'},say='Уже меняю пол.')
        self.assertEqual(self.body.goals,[]);self.assertEqual(self.body.speech,[])
    def test_two_failed_attempts_pause_only_the_current_request(self):
        self.message('Сделай пол');self.runtime.tick()
        for attempt in range(2):
            self.planner.answer={**plan(),'instruction_id':'order','goal':{'kind':'obtain','item':'stone','count':9,'deliver':False}}
            self.runtime.tick();goal=self.body.goals[-1]
            self.body.finish(goal['goal_id'],'blocked','failure-'+str(attempt))
            self.runtime.tick()
        self.planner.answer={**plan(),'instruction_id':'order','goal':{'kind':'obtain','item':'stone','count':9,'deliver':False},'say':'Пробую опять.'}
        self.runtime.tick()
        self.assertEqual(len(self.body.goals),2);self.assertNotIn('Пробую опять.',self.body.speech)
        self.message('Подойди ко мне','next');self.runtime.tick()
        self.assertEqual(self.body.goals[-1]['spec'],{'kind':'come','target':'SkipperBot'})

    def start_follow(self):
        self.message('Иди за мной','follow',observed_at=98)
        self.runtime.tick()
        identifier=self.body.goals[-1]['goal_id']
        self.assertEqual(self.body.state['active_goal_id'],identifier)
        return identifier

    def test_stop_then_question_in_one_batch_still_cancels_active_work(self):
        old=self.start_follow()
        self.message('Стой!','stop',observed_at=99)
        self.message('Ты меня слышишь?','question',observed_at=100)
        self.runtime.tick()
        self.assertIn(old,self.body.cancelled)
        self.assertIsNone(self.body.state['active_goal_id'])
        self.assertEqual([g['spec'] for g in self.body.goals if g['spec'].get('kind')!='native'],
                         [{'kind':'follow','target':'SkipperBot'}])

    def test_newer_nonquick_correction_withholds_older_follow_or_come_in_the_same_batch(self):
        for command in ('Иди за мной','Подойди ко мне'):
            with self.subTest(command=command):
                body=DirectedBody();body.state['native_capabilities']={'enabled':True}
                planner=Planner();memory=Memory(':memory:')
                runtime=Runtime(body,planner,memory,{'persona_id':'TolikScheben'},clock=lambda:100,
                                operators={'SkipperBot':'operator-uuid'},directed=True)
                try:
                    for sequence,text,identifier,at in ((1,command,'movement',99),(2,'Нет, отмени это','correction',100)):
                        body.queue.append(dict(type='chat',event_id=identifier,session_id='s',sequence=sequence,
                            user='SkipperBot',sender_uuid='operator-uuid',msg=text,observed_at=at,
                            source='server_formatted',operator_authorized=False))
                    runtime.tick()
                    self.assertEqual(runtime.control.current['event_id'],'correction')
                    self.assertEqual(body.goals,[])
                    self.assertIsNone(body.state['active_goal_id'])
                finally:
                    runtime.close();memory.close()

    def test_follow_replaces_ambiguously_accepted_goal_using_the_post_cancel_snapshot(self):
        self.message('Добудь камень','old-order',observed_at=98)
        self.body.accept_then_timeout=True
        self.answer(instruction_id='old-order',goal={'kind':'obtain','item':'stone','count':9,'deliver':False})
        old=self.body.goals[-1]['goal_id']
        self.assertEqual(self.body.state['active_goal_id'],old)
        self.assertEqual(self.runtime.uncertain['goal_id'],old)
        self.message('Иди за мной','follow',observed_at=100)
        self.runtime.tick()
        self.assertIn(old,self.body.cancelled)
        self.assertEqual(len(self.body.goals),2)
        self.assertEqual(self.body.goals[-1]['spec'],{'kind':'follow','target':'SkipperBot'})
        self.assertEqual(self.body.state['active_goal_id'],self.body.goals[-1]['goal_id'])

    def test_newer_spoken_stop_wins_over_older_chat_delivered_in_the_same_poll(self):
        old=self.start_follow()
        self.runtime.voice=Voice(dict(type='voice',event_id='spoken-stop',session_id='s',
            user='SkipperBot',speaker_uuid='operator-uuid',msg='Стой!',observed_at=100))
        self.message('Иди за мной','older-chat',observed_at=99)
        self.runtime.tick()
        self.assertIn(old,self.body.cancelled)
        self.assertIsNone(self.body.state['active_goal_id'])
        self.assertEqual(len([g for g in self.body.goals if g['spec']['kind']=='follow']),1)

    def test_completed_stop_instruction_cannot_authorize_a_new_move(self):
        self.message('Стой!','stop');self.runtime.tick();self.runtime.tick()
        count=len(self.body.goals)
        self.runtime.apply({**plan(),'instruction_id':'stop',
                            'goal':{'kind':'move','target':{'x':100,'y':64,'z':0}},
                            'say':'Иду дальше.'},self.body.snapshot(),self.body.snapshot())
        self.assertEqual(len(self.body.goals),count)
        self.assertIsNone(self.body.state['active_goal_id'])
        self.assertNotIn('Иду дальше.',self.body.speech)

    def test_two_failed_resumes_pause_until_a_new_operator_instruction(self):
        self.message('Продолжай прошлую задачу','resume-order');self.runtime.tick()
        resume={'kind':'native','request':'resume','requester':'SkipperBot'}
        for attempt in range(2):
            self.planner.answer={**plan(),'instruction_id':'resume-order','goal':resume}
            self.runtime.tick()
            self.body.finish(self.body.goals[-1]['goal_id'],'blocked','resume-failure-'+str(attempt))
            self.runtime.tick()
        self.assertEqual(len(self.body.goals),2)
        self.assertTrue(self.runtime.control.paused)
        self.runtime.apply({**plan(),'instruction_id':'resume-order','goal':resume,'say':'Снова продолжаю.'},
                           self.body.snapshot(),self.body.snapshot())
        self.assertEqual(len(self.body.goals),2)
        self.assertNotIn('Снова продолжаю.',self.body.speech)
        self.message('Подойди ко мне','next',observed_at=101);self.runtime.tick()
        self.assertEqual(self.body.goals[-1]['spec'],{'kind':'come','target':'SkipperBot'})

    def test_action_speech_is_withheld_when_current_work_prevents_dispatch(self):
        old=self.start_follow()
        self.message('Добудь камень','stone',observed_at=100)
        self.runtime.tick()
        # Apply a current plan directly so a stale inference revision cannot
        # hide the action-disposition/speech ordering being tested here.
        self.runtime.apply({**plan(),'instruction_id':'stone',
                            'goal':{'kind':'obtain','item':'stone','count':9,'deliver':False},
                            'say':'Уже добываю камень.'},self.body.snapshot(),self.body.snapshot())
        self.assertEqual(self.body.state['active_goal_id'],old)
        self.assertEqual(len(self.body.goals),1)
        self.assertNotIn('Уже добываю камень.',self.body.speech)

    def test_action_speech_is_withheld_when_body_admission_rejects_the_goal(self):
        self.message('Добудь камень','stone');self.body.reject_submit='unworkable'
        self.answer(instruction_id='stone',goal={'kind':'obtain','item':'stone','count':9,'deliver':False},
                    say='Уже добываю камень.')
        self.assertEqual(len(self.body.goals),1)
        self.assertIsNone(self.body.state['active_goal_id'])
        self.assertNotIn('Уже добываю камень.',self.body.speech)


if __name__=='__main__':unittest.main()
