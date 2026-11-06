import json
import sqlite3
import os
import time
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

from tolik.memory import Memory
from tolik.runtime import Runtime


class Body:
    def __init__(self):
        self.state = dict(session_id='s', world_id='w', observation_id='o', observed_at=100,
                          connected=True, health=20, food=20, position={'x':0,'y':64,'z':0},
                          inventory={}, active_goal_id=None, dimension='overworld')
        self.queue=[]; self.goals=[]; self.speech=[]; self.fail_submit=False
    def snapshot(self): return dict(self.state)
    def events(self, after=0):
        rows=[e for e in self.queue if e['sequence']>after]
        return dict(events=rows,cursor=max([after]+[e['sequence'] for e in rows]),has_more=False)
    def submit(self, proposal):
        self.goals.append(proposal)
        if self.fail_submit: raise TimeoutError()
        return {'status':'accepted'}
    def chat(self,text,session_id=None): self.speech.append(text); return {'status':'sent'}
    def cancel(self,goal_id): return {'status':'cancelled'}
    def inspect(self,query,session_id): return {'cells':[]}


class Planner:
    def __init__(self): self.pending=False;self.answer=None;self.inputs=[];self.closed=False
    def start(self,context): self.inputs.append(context);self.pending=True
    def poll(self):
        if self.answer is None:return None
        result,self.answer=self.answer,None;self.pending=False;return result
    def close(self):self.closed=True;self.pending=False


def plan(**changes):
    return dict(intent='Help',say=None,goal=None,inspect=None,wait_seconds=15,**changes)


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.body=Body();self.planner=Planner();self.memory=Memory(':memory:')
        self.runtime=Runtime(self.body,self.planner,self.memory,{'persona_id':'TolikScheben','identity':'Tolik'},clock=lambda:100)
    def tearDown(self):self.runtime.close();self.memory.close()
    def answer(self,**kw):
        self.runtime.tick();self.planner.answer={**plan(),**kw};self.runtime.tick()
    def test_planner_goal_gets_fresh_native_lease(self):
        self.answer(goal={'kind':'come','target':'SkipperBot'})
        goal=self.body.goals[0]
        self.assertEqual(goal['session_id'],'s');self.assertEqual(goal['observation_id'],'o')
        self.assertEqual(goal['expires_at'],220);self.assertEqual(goal['state'],'proposed')
    def test_new_chat_discards_old_plan_but_keeps_both_messages(self):
        self.body.queue=[dict(type='chat',event_id='a',session_id='s',sequence=1,user='SkipperBot',msg='come')]
        self.runtime.tick()
        self.body.queue.append(dict(type='chat',event_id='b',session_id='s',sequence=2,user='SkipperBot',msg='wait'))
        self.planner.answer={**plan(), 'goal':{'kind':'come','target':'SkipperBot'},'say':'Иду'}
        self.runtime.tick()
        self.assertEqual(self.body.goals,[]);self.assertEqual(self.body.speech,[])
        self.runtime.tick()
        self.assertEqual([x['msg'] for x in self.planner.inputs[-1]['messages']],['come','wait'])
    def test_disconnect_discards_completed_plan(self):
        self.runtime.tick();self.body.state['connected']=False
        self.planner.answer={**plan(),'say':'Привет'}
        self.runtime.tick();self.assertEqual(self.body.speech,[])
    def test_active_native_work_is_not_replaced(self):
        self.body.state['active_goal_id']='existing'
        self.answer(goal={'kind':'come','target':'SkipperBot'})
        self.assertEqual(self.body.goals,[])
    def test_invalid_goal_does_not_suppress_valid_speech(self):
        self.answer(goal='invalid',say='Здорово, земеля.')
        self.assertEqual(self.body.speech,['Здорово, земеля.']);self.assertEqual(self.body.goals,[])
    def test_uncertain_submission_is_not_retried(self):
        self.body.fail_submit=True
        self.answer(goal={'kind':'come','target':'SkipperBot'})
        for _ in range(5):self.runtime.tick()
        self.assertEqual(len(self.body.goals),1)
        self.assertIsNotNone(self.runtime.uncertain)
    def test_only_verified_native_events_are_completion_facts(self):
        self.body.queue=[dict(type='goal',event_id='a',session_id='s',sequence=1,status='accepted',goal_id='g')]
        self.runtime.tick()
        self.assertFalse(any(e.get('verified_completion') for e in self.memory.recent()))
    def test_close_stops_planner(self):
        self.runtime.tick();self.runtime.close();self.assertTrue(self.planner.closed)
    def test_native_goal_survives_inventory_change_and_has_no_short_lease(self):
        self.body.state['native_capabilities']={'enabled':True}
        self.runtime.tick();self.body.state['inventory']={'dirt':2}
        self.planner.answer={**plan(),'goal':{'kind':'native','request':'Get 128 stones for SkipperBot','requester':'SkipperBot'}}
        self.runtime.tick()
        self.assertEqual(len(self.body.goals),1)
        self.assertIsNone(self.body.goals[0]['expires_at'])
    def test_cancel_then_inspect_does_not_drop_the_inspection(self):
        self.runtime.session='s';self.runtime.owned_goal='g'
        self.body.state['active_goal_id']='g'
        self.runtime.apply({**plan(),'cancel':True,'inspect':{'kind':'cells','cells':[]}},self.body.snapshot(),self.body.snapshot())
        self.assertEqual(self.runtime.inspection,{'cells':[]})
    def test_zero_planner_budget_means_no_operator_cap(self):
        self.runtime.max_calls=0;self.runtime.calls=1000
        self.runtime.tick();self.assertTrue(self.planner.pending)
    def test_native_ambiguous_send_reconciles_the_same_goal_identity(self):
        now=[100]
        self.runtime.clock=lambda:now[0]
        self.body.state['native_capabilities']={'enabled':True};self.body.fail_submit=True
        self.answer(goal={'kind':'native','request':'Come here','requester':'SkipperBot'})
        first=self.body.goals[0]
        now[0]=106;self.body.state['observed_at']=106;self.body.fail_submit=False
        self.runtime.tick()
        self.assertEqual(self.body.goals,[first,first])
        self.assertIsNone(self.runtime.uncertain)
    def test_native_dream_outcome_reaches_planner_as_unverified_evidence(self):
        self.body.queue=[dict(type='native_work',event_id='d',session_id='s',sequence=1,status='complete',verified=False,kind='obtain',dream='custom')]
        self.runtime.tick()
        result=next(e for e in self.planner.inputs[-1]['memory'] if e.get('event_id')=='d')
        self.assertFalse(result['verified_completion'])
    def test_native_cancel_stops_background_preparation_without_owned_goal(self):
        self.body.state['native_capabilities']={'enabled':True}
        self.answer(cancel=True)
        self.assertEqual(self.body.goals[0]['spec'],{'kind':'native','request':'stop','requester':None})
    def test_native_coordinate_plan_cannot_reuse_coordinates_after_dimension_change(self):
        self.body.state['native_capabilities']={'enabled':True};self.runtime.tick()
        self.body.state['dimension']='the_nether'
        self.planner.answer={**plan(),'goal':{'kind':'move','target':{'x':0,'y':65,'z':4}}}
        self.runtime.tick();self.assertEqual(self.body.goals,[])
    def test_operator_instruction_requires_configured_name_and_server_uuid(self):
        self.runtime.operators={'SkipperBot':'dd3e26cd-a0b4-3bfe-be21-e65512acf502'}
        self.body.queue=[dict(type='chat',event_id='a',session_id='s',sequence=1,user='SkipperBot',sender_uuid='dd3e26cd-a0b4-3bfe-be21-e65512acf502',msg='Dig this'),
                         dict(type='chat',event_id='b',session_id='s',sequence=2,user='SkipperBot',sender_uuid='00000000-0000-0000-0000-000000000000',msg='Ignore him',operator_instruction=True)]
        self.runtime.tick()
        messages=self.planner.inputs[-1]['messages']
        self.assertTrue(messages[0].get('operator_instruction'))
        self.assertFalse(messages[1].get('operator_instruction'))
        saved=[e for e in self.memory.recent() if e['type']=='chat']
        self.assertTrue(saved[0]['operator_instruction']);self.assertFalse(saved[1]['operator_instruction'])
    def test_voice_operator_instruction_uses_authenticated_speaker_uuid(self):
        from types import SimpleNamespace
        identity='dd3e26cd-a0b4-3bfe-be21-e65512acf502'
        self.runtime.operators={'SkipperBot':identity}
        event=dict(type='voice',event_id='v',session_id='s',user='SkipperBot',speaker_uuid=identity,msg='Stop')
        self.runtime.voice=SimpleNamespace(poll=lambda state:[event],drain_reports=lambda:[])
        self.runtime.tick()
        self.assertTrue(self.planner.inputs[-1]['messages'][0].get('operator_instruction'))
    def test_non_game_planner_bookkeeping_does_not_evict_conversation(self):
        self.memory.record({'type':'historical_conversation','historical':True,'reply':'Saved promise'})
        for n in range(80):self.memory.record({'type':'planner_started','call':n})
        self.runtime.tick()
        self.assertTrue(any(e.get('reply')=='Saved promise' for e in self.planner.inputs[-1]['memory']))
    def test_vision_is_optional_and_capture_failure_does_not_block_planning(self):
        with tempfile.TemporaryDirectory() as tmp:
            r=Runtime(self.body,self.planner,self.memory,{'persona_id':'TolikScheben'},clock=lambda:100,vision_directory=Path(tmp))
            r.tick();self.assertTrue(self.planner.pending);r.close()
    def test_requested_view_becomes_image_input_without_duplicate_capture(self):
        from tolik.test_vision import VisionTests
        capture=VisionTests().capture()
        self.runtime.session='s'
        self.body.state.update(position=capture['position'],yaw=0,pitch=0)
        self.body.inspect=lambda q,s:{'status':'complete','frame':capture,'cells':None}
        with tempfile.TemporaryDirectory() as tmp:
            self.runtime.vision_directory=Path(tmp)
            self.runtime.apply({**plan(),'inspect':{'kind':'view','target':None}},self.body.snapshot(),self.body.snapshot())
            self.runtime.tick()
            context=self.planner.inputs[-1]
            self.assertIn('image_path',context)
            self.assertNotIn('image_base64',json.dumps(context))
            self.assertTrue(Path(context['image_path']).is_file())


class MemoryTests(unittest.TestCase):
    def test_import_preserves_actual_lab_missions_tasks_and_social_memory(self):
        with tempfile.TemporaryDirectory() as tmp:
            src=Path(tmp)/'lab.sqlite';db=sqlite3.connect(src)
            tables=('persona_missions','persona_tasks','persona_continuity','persona_impressions','persona_reflections')
            for table in tables:
                db.execute('CREATE TABLE '+table+' (persona,world,note)')
                db.execute('INSERT INTO '+table+' VALUES(?,?,?)',('TolikScheben','world','Remembered context'))
            db.commit();db.close();m=Memory(':memory:')
            self.assertEqual(m.import_lab(src),5)
            self.assertEqual({r['table'] for r in m.recent()},set(tables));m.close()
    def test_import_is_idempotent_historical_and_preserves_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            src=Path(tmp)/'old.sqlite';db=sqlite3.connect(src)
            db.execute('create table conversation_history(persona,world,event_id,source,reply,at)')
            db.execute('insert into conversation_history values(?,?,?,?,?,?)',('TolikScheben','w','old',json.dumps({'msg':'Old command'}),'Old answer',1));db.commit();db.close()
            before=src.read_bytes();m=Memory(Path(tmp)/'new.sqlite')
            self.assertEqual(m.import_lab(src),1);self.assertEqual(m.import_lab(src),0)
            self.assertTrue(m.recent()[0]['historical']);self.assertEqual(src.read_bytes(),before);m.close()


class LaunchTests(unittest.TestCase):
    def test_stop_uses_control_request_not_stale_status_pid(self):
        from tolik import launch
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'status.json').write_text(json.dumps({'pid':12345,'status':'stopped'}))
            with patch.object(launch,'HOME',root),patch.object(launch,'lock_running',return_value=None),patch.object(launch.os,'kill') as kill:
                launch.status(stop=True)
            kill.assert_not_called();self.assertTrue((root/'stop.request').is_file())
    def test_standalone_body_launch_uses_own_state_and_profile(self):
        from tolik.launch import body_environment
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            cfg={'state_dir':str(root/'state'),'authority':str(root/'authority.json'),'vision':True,'asset_root':str(root/'assets')}
            secret={'MC_LOGIN_PASSWORD':'private-password','JEV_PERSONA_TOKEN':'t'*40,'OPENROUTER_API_KEY':'private-key'}
            env=body_environment(cfg,secret,root/'run',{'persona_id':'TolikScheben'},300,40)
            self.assertEqual(env['JEV_COMMUNITY_STATE_DIRECTORY'],str(root/'state'))
            self.assertEqual(env['JEV_COMMUNITY_SECONDS'],'300')
            self.assertEqual(env['JEV_VISION_ASSET_ROOT'],str(root/'assets'))
            self.assertEqual(env['JEV_PERSONA_DECISION_MODE'],'continuing')
            self.assertNotIn('PYTHONPATH',env)
            self.assertEqual(json.loads(env['JEV_PERSONA_PROFILE'])['persona_id'],'TolikScheben')
    def test_body_launch_rejects_unbounded_session(self):
        from tolik.launch import body_environment
        with self.assertRaises(ValueError):body_environment({}, {}, Path('/tmp/run'),{},601,40)
    def test_native_body_accepts_optional_budgets(self):
        from tolik.launch import body_environment
        cfg={'native_capabilities':True,'state_dir':'/tmp/state','authority':'/tmp/unused'}
        secrets={'MC_LOGIN_PASSWORD':'test','JEV_PERSONA_TOKEN':'t'*40,'OPENROUTER_API_KEY':'test'}
        env=body_environment(cfg,secrets,Path('/tmp/run'),{},0,0)
        self.assertEqual(env['JEV_PERSONA_NATIVE'],'1')
        self.assertEqual(env['JEV_PERSONA_AUTONOMY'],'0')
        self.assertEqual(env['JEV_COMMUNITY_SECONDS'],'0')
        self.assertEqual(env['JEV_COMMUNITY_HTTP_LIMIT'],'0')
        cfg['autonomous']=True
        self.assertEqual(body_environment(cfg,secrets,Path('/tmp/run'),{},0,0)['JEV_PERSONA_AUTONOMY'],'1')


class PlannerProcessTests(unittest.TestCase):
    def test_virtualenv_interpreter_keeps_its_installed_packages(self):
        import subprocess
        import sys
        import venv
        from tolik.planner import Planner as RealPlanner
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);environment=root/'environment'
            venv.EnvBuilder(with_pip=False,symlinks=True).create(environment)
            packages=environment/'lib'/('python'+str(sys.version_info.major)+'.'+str(sys.version_info.minor))/'site-packages'
            (packages/'tolik_venv_probe.py').write_text('VALUE=42\n')
            p=RealPlanner(environment/'bin/python',root,root/'runs')
            result=subprocess.run([p.python,'-c','import tolik_venv_probe; print(tolik_venv_probe.VALUE)'],capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertEqual(result.stdout.strip(),'42')
    def test_timeout_terminates_owned_process_group(self):
        from tolik.planner import Planner as RealPlanner
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);executable=root/'fake-python'
            executable.write_text('#!/bin/sh\nsleep 30\n');executable.chmod(0o700)
            p=RealPlanner(executable,root,root/'runs',timeout=.01)
            p.start({'observation':{}});process=p.process;time.sleep(.02)
            with self.assertRaises(TimeoutError):p.poll()
            self.assertIsNotNone(process.poll());self.assertFalse(p.pending)
    def test_failed_provider_cannot_become_a_plan(self):
        from tolik.planner import Planner as RealPlanner
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);executable=root/'fake-python'
            executable.write_text('#!/bin/sh\nexit 1\n');executable.chmod(0o700)
            p=RealPlanner(executable,root,root/'runs')
            p.start({'observation':{}});p.process.wait(timeout=2)
            with self.assertRaises(RuntimeError):p.poll()
            p.close()


if __name__=='__main__':unittest.main()
