"""Standalone launcher and one-time migration. All private state lives in .tolik."""
import argparse
from datetime import datetime,timezone
import fcntl
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import time

from .body import Body
from .memory import Memory
from .planner import Planner
from .runtime import Runtime

ROOT=Path(__file__).resolve().parents[1]
HOME=ROOT/'.tolik'
ITEMS='oak_log,spruce_log,birch_log,cobblestone,crafting_table,wooden_pickaxe,stone_pickaxe,coal,torch,oak_planks,spruce_planks,birch_planks,stick,furnace,raw_iron,iron_ingot,iron_pickaxe,stone_axe,bread,cooked_beef,charcoal,stone,stone_shovel,iron_axe,iron_sword,shield,bucket,shears,white_bed,chest,dirt,sand,glass,glass_pane,ladder,oak_door,spruce_door,oak_stairs,spruce_stairs,cobblestone_stairs,oak_slab,spruce_slab,cobblestone_slab,oak_fence,spruce_fence,white_wool,black_wool,gray_wool,brown_wool,black_bed,gray_bed,brown_bed'


def write_json(path,value):
    path=Path(path);temporary=path.with_suffix('.tmp')
    with os.fdopen(os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600),'w') as stream:
        json.dump(value,stream,ensure_ascii=False,indent=2)
    temporary.replace(path)


def body_environment(config,secrets,run,profile,seconds,attempts):
    if type(seconds) is not int or not 1<=seconds<=600 or type(attempts) is not int or not 1<=attempts<=60:
        raise ValueError('Launch bounds are 1..600 seconds and 1..60 Jev attempts')
    env={k:v for k,v in os.environ.items() if k in {'PATH','HOME','TMPDIR','LANG','LC_ALL'}}
    for key in ('MC_LOGIN_PASSWORD','JEV_PERSONA_TOKEN','OPENROUTER_API_KEY'):
        if not secrets.get(key):raise ValueError('Missing '+key)
        env[key]=secrets[key]
    if secrets.get('MC_LOGIN_SUCCESS_TEXT'):env['MC_LOGIN_SUCCESS_TEXT']=secrets['MC_LOGIN_SUCCESS_TEXT']
    env.update(JEV_PERSONA_PROFILE=json.dumps(profile,ensure_ascii=False),
        JEV_PERSONA_VISIT='1',JEV_PERSONA_CRAFT_FROM_INVENTORY='1',
        JEV_PERSONA_ITEMS=ITEMS,JEV_PERSONA_DECISION_MODE='continuing',
        JEV_COMMUNITY_CHARACTER='TolikScheben',JEV_COMMUNITY_SECONDS=str(seconds),
        JEV_COMMUNITY_HTTP_LIMIT=str(attempts),JEV_COMMUNITY_RUN_DIRECTORY=str(run),
        JEV_COMMUNITY_STATE_DIRECTORY=config['state_dir'],JEV_MUTATION_AUTHORITY=config['authority'],
        JEV_VISION_ENABLED='1' if config.get('vision',True) else '0',
        JEV_SVC_ENABLED='1' if config.get('voice',False) else '0')
    if config.get('asset_root'):env['JEV_VISION_ASSET_ROOT']=config['asset_root']
    return env


def migrate(args):
    from dotenv import dotenv_values
    community=Path(args.community).resolve()
    character=community/'characters/TolikScheben'
    HOME.mkdir(mode=0o700,exist_ok=True)
    if (HOME/'config.json').exists():raise RuntimeError('Already configured; migration will not overwrite state')
    private=dotenv_values(community/'tolik-private.env')
    if not private.get('OPENROUTER_API_KEY') and args.key_env:
        private['OPENROUTER_API_KEY']=dotenv_values(args.key_env).get('OPENROUTER_API_KEY')
    selected={k:private[k] for k in ('MC_LOGIN_PASSWORD','JEV_PERSONA_TOKEN','OPENROUTER_API_KEY','MC_LOGIN_SUCCESS_TEXT') if private.get(k)}
    if any(not selected.get(k) for k in ('MC_LOGIN_PASSWORD','JEV_PERSONA_TOKEN','OPENROUTER_API_KEY')):
        raise RuntimeError('Existing community credentials are incomplete')
    # JSON avoids shell interpolation and dotenv quoting ambiguities.
    write_json(HOME/'credentials.json',selected)
    shutil.copytree(character/'body-state',HOME/'body-state')
    shutil.copy2(character/'mutation-authority.json',HOME/'mutation-authority.json')
    assets=community/'vision-assets/1.21.11'
    if assets.exists():shutil.copytree(assets,HOME/'vision-assets')
    memory=Memory(HOME/'memory.sqlite')
    imported=memory.import_lab(character/'episodes.sqlite');memory.close()
    config=dict(hermes_python=os.path.abspath(os.path.expanduser(args.hermes_python)),hermes_home=str(HOME/'hermes'),
        model='gpt-6-luna',state_dir=str(HOME/'body-state'),authority=str(HOME/'mutation-authority.json'),
        vision=assets.exists(),asset_root=str(HOME/'vision-assets'),voice=False,voice_send=False,voice_players=[],memory=str(HOME/'memory.sqlite'))
    write_json(HOME/'config.json',config)
    print(json.dumps({'configured':True,'historical_records_imported':imported,'config':str(HOME/'config.json')}))


def stop_process(process):
    if not process:return
    try:os.killpg(process.pid,signal.SIGTERM)
    except ProcessLookupError:pass
    try:process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        try:os.killpg(process.pid,signal.SIGKILL)
        except ProcessLookupError:pass
        process.wait(timeout=2)


def lock_running():
    HOME.mkdir(mode=0o700,exist_ok=True)
    lock=open(HOME/'run.lock','a+')
    try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError:lock.close();return None
    return lock


def status(stop=False):
    lock=lock_running()
    state=json.loads((HOME/'status.json').read_text()) if (HOME/'status.json').exists() else {'status':'never_started'}
    if lock:
        lock.close();state['running']=False
    else:
        state['running']=True
        if stop:
            write_json(HOME/'stop.request',{'requested_at':time.time()})
            state['stop_requested']=True
    print(json.dumps(state,ensure_ascii=False,indent=2))


def run(args):
    if not 1<=args.seconds<=600 or not 1<=args.max_calls<=60:raise ValueError('Invalid session bounds')
    began=time.time()
    lock=lock_running()
    if lock is None:raise RuntimeError('Tolik is already running')
    config=json.loads((HOME/'config.json').read_text())
    secrets=json.loads((HOME/'credentials.json').read_text())
    profile=json.loads((ROOT/'tolik/profile.json').read_text())
    with socket.socket() as check:
        check.settimeout(1)
        if check.connect_ex(('127.0.0.1',8770))==0:raise RuntimeError('Tolik bridge is occupied; existing controller preserved')
    run_dir=HOME/'runs'/datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
    run_dir.mkdir(parents=True,mode=0o700)
    env=body_environment(config,secrets,run_dir/'body',profile,args.seconds,args.max_jev)
    body_log=open(run_dir/'body.log','w')
    body_process=None;runtime=None;memory=None;voice=None;reason='deadline';stopping=False
    def shutdown(signum,frame):
        nonlocal stopping,reason
        stopping=True;reason='operator_stop'
    signal.signal(signal.SIGTERM,shutdown);signal.signal(signal.SIGINT,shutdown)
    deadline=time.monotonic()+args.seconds
    def requested():
        if stopping:return True
        try:return json.loads((HOME/'stop.request').read_text()).get('requested_at',0)>=began
        except (OSError,ValueError):return False
    status_data=dict(status='starting',pid=os.getpid(),run_dir=str(run_dir),started_at=began,
        deadline=began+args.seconds,model=config['model'],max_calls=args.max_calls,max_jev=args.max_jev)
    write_json(HOME/'status.json',status_data)
    print('Tolik run: '+str(run_dir),flush=True)
    try:
        body_process=subprocess.Popen(['node','scripts/community.js'],cwd=ROOT,env=env,
            stdin=subprocess.DEVNULL,stdout=body_log,stderr=body_log,start_new_session=True)
        body=Body('http://127.0.0.1:8770',secrets['JEV_PERSONA_TOKEN'])
        while time.monotonic()<deadline and not requested():
            if body_process.poll() is not None:raise RuntimeError('Body exited before readiness')
            try:state=body.snapshot()
            except (OSError,RuntimeError,ValueError):time.sleep(.5);continue
            if state.get('connected') is True:break
            time.sleep(.5)
        else:
            if requested():reason='operator_stop';return
            raise RuntimeError('Body readiness deadline elapsed')
        if state.get('world_id')!='agicraft-community-1_21_11-tolik':raise RuntimeError('Wrong world')
        write_json(run_dir/'initial.json',state)
        memory=Memory(config['memory'])
        planner=Planner(config['hermes_python'],config['hermes_home'],run_dir/'planner',model=config['model'])
        if config.get('voice'):
            from .voice_service import VoiceService
            voice=VoiceService(body.url,secrets['JEV_PERSONA_TOKEN'],config)
        runtime=Runtime(body,planner,memory,profile,max_calls=args.max_calls,voice=voice,
            operators=config.get('operators',{}),
            vision_directory=run_dir/'vision' if config.get('vision',True) else None)
        status_data.update(status='running',session_id=state['session_id'],body_pid=body_process.pid)
        write_json(HOME/'status.json',status_data)
        print('Tolik connected; Hermes planner active.',flush=True)
        last_sample=0
        while time.monotonic()<deadline and not requested() and body_process.poll() is None:
            runtime.tick()
            if runtime.last_snapshot.get('connected') is not True:reason='disconnected';break
            if runtime.last_snapshot.get('health',20)<10:reason='low_health';break
            if time.monotonic()-last_sample>=2:
                with open(run_dir/'observations.jsonl','a') as stream:stream.write(json.dumps(runtime.last_snapshot,ensure_ascii=False)+'\n')
                last_sample=time.monotonic()
            if runtime.calls>=args.max_calls and not runtime.inflight:reason='planner_budget';break
            time.sleep(.25)
        if body_process.poll() is not None:reason='body_stopped'
        elif requested():reason='operator_stop'
    except Exception as error:
        reason=type(error).__name__+': '+str(error)
        raise
    finally:
        if runtime:runtime.close()
        stop_process(body_process);body_log.close()
        if voice:voice.close()
        if runtime and runtime.last_snapshot:write_json(run_dir/'final.json',runtime.last_snapshot)
        status_data.update(status='stopped',stopped_at=time.time(),reason=reason,
            planner_calls=runtime.calls if runtime else 0,body_exit=body_process.returncode if body_process else None)
        write_json(HOME/'status.json',status_data);write_json(run_dir/'summary.json',status_data)
        if memory:memory.close()
        lock.close()
        print(json.dumps(status_data,ensure_ascii=False),flush=True)


def main():
    os.umask(0o077)
    parser=argparse.ArgumentParser(description='Standalone Tolik: Hermes + JevCraft')
    sub=parser.add_subparsers(dest='command',required=True)
    migrate_parser=sub.add_parser('migrate',help='Copy existing community configuration and memory once')
    migrate_parser.add_argument('--community',required=True);migrate_parser.add_argument('--key-env')
    migrate_parser.add_argument('--hermes-python',required=True)
    run_parser=sub.add_parser('run');run_parser.add_argument('--seconds',type=int,default=300)
    run_parser.add_argument('--max-calls',type=int,default=24);run_parser.add_argument('--max-jev',type=int,default=40)
    sub.add_parser('status');sub.add_parser('stop')
    args=parser.parse_args()
    if args.command=='migrate':migrate(args)
    elif args.command=='run':run(args)
    else:status(stop=args.command=='stop')
