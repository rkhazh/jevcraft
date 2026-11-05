"""Isolated bounded community profile. Registration requires explicit opt-in; no admin commands."""
import os
import json
import math
import re
import argparse
import importlib.util
from datetime import datetime, timezone
from pathlib import Path
from dotenv import dotenv_values
parser=argparse.ArgumentParser()
parser.add_argument('--restoration-authorization',type=Path,help='Explicit operator-approved local restoration artifact; disabled by default')
parser.add_argument('--vision',action='store_true',help='Enable bounded simplified bot-eye perception')
parser.add_argument('--voice',action='store_true',help='Enable SVC handshake and authenticated voice metadata')
parser.add_argument('--character',choices=['Skipper','TolikScheben'],default='Skipper')
parser.add_argument('--first-register',action='store_true',help='Allow one registration command when the trusted server requests it')
parser.add_argument('--warp-ai',action='store_true',help='Warp once to the server ai destination before gameplay')
parser.add_argument('--rendezvous-player')
parser.add_argument('--rendezvous-position',nargs=3,type=float,metavar=('X','Y','Z'))
parser.add_argument('--max-http-attempts',type=int,default=60,help='Remaining actual HTTP attempt allowance (1..60, including retries)')
args=parser.parse_args()
if not 1<=args.max_http_attempts<=60: parser.error('HTTP attempt limit must be 1..60')
if bool(args.rendezvous_player)!=(args.rendezvous_position is not None): parser.error('Rendezvous player and position must be supplied together')
if args.rendezvous_player:
 x,y,z=args.rendezvous_position
 if not re.fullmatch(r'[A-Za-z0-9_]{1,16}',args.rendezvous_player) or not all(map(math.isfinite,(x,y,z))) or abs(x)>29999984 or abs(z)>29999984 or not -64<=y<=319: parser.error('Invalid rendezvous player or coordinates')
root=Path(__file__).resolve().parents[2]
try:
 spec=importlib.util.spec_from_file_location('configured_community_persona',root/'NetTyan/scripts/community-persona.py')
 configured=importlib.util.module_from_spec(spec)
 spec.loader.exec_module(configured)
 persona_profile=json.dumps(configured.configured_profile(args.character),ensure_ascii=False,separators=(',',':'),allow_nan=False)
 if len(persona_profile.encode('utf-8'))>24576:raise ValueError('Profile too large')
except Exception:
 raise SystemExit('Configured community persona unavailable or invalid') from None
profile=root/'setup/jevcraft-community'
authority=profile/'characters'/args.character/'mutation-authority.json'
tolik=args.character=='TolikScheben'
private=dotenv_values(profile/('tolik-private.env' if tolik else 'private.env'))
key=private.get('OPENROUTER_API_KEY') or dotenv_values(root/'NetTyan/.env').get('OPENROUTER_API_KEY')
if not key: raise SystemExit('Configured OpenRouter key unavailable')
# Deliberately do not inherit local house goals, voice endpoints or profile settings.
env={k:v for k,v in os.environ.items() if k in {'PATH','HOME','TMPDIR','LANG','LC_ALL'}}
env['JEV_PERSONA_PROFILE']=persona_profile
env['JEV_PERSONA_VISIT']='1' if tolik else '0'
if authority.exists():env['JEV_MUTATION_AUTHORITY']=str(authority)
for k in ['MC_LOGIN_PASSWORD','JEV_PERSONA_TOKEN']:
 if not private.get(k): raise SystemExit(f'Missing community configuration: {k}')
 env[k]=private[k]
if private.get('MC_LOGIN_SUCCESS_TEXT'): env['MC_LOGIN_SUCCESS_TEXT']=private['MC_LOGIN_SUCCESS_TEXT']
env.update(JEV_VISION_ENABLED='1' if args.vision else '0',JEV_COMMUNITY_WARP_AI='1' if args.warp_ai else '0',JEV_COMMUNITY_CHARACTER=args.character,JEV_COMMUNITY_FIRST_REGISTER='1' if args.first_register else '0',JEV_SVC_ENABLED='1' if args.voice else '0',OPENROUTER_API_KEY=key,JEV_COMMUNITY_SECONDS='600',JEV_COMMUNITY_HTTP_LIMIT=str(args.max_http_attempts),JEV_PERSONA_ITEMS='oak_log,spruce_log,birch_log,cobblestone,crafting_table,wooden_pickaxe,stone_pickaxe,coal,torch,oak_planks,spruce_planks,birch_planks,stick,furnace,raw_iron,iron_ingot,iron_pickaxe,stone_axe,bread,cooked_beef,charcoal')
if args.restoration_authorization:
 if args.restoration_authorization.is_symlink() or not args.restoration_authorization.is_file(): parser.error('Restoration authorization must be a regular local file')
 env['JEV_RESTORATION_AUTHORIZATION']=str(args.restoration_authorization.absolute())
if args.rendezvous_player: env['JEV_COMMUNITY_RENDEZVOUS']=json.dumps(dict(target=args.rendezvous_player,position=dict(zip(('x','y','z'),args.rendezvous_position)),dimension='overworld'))
if tolik: env['JEV_PERSONA_ITEMS']+=',stone,stone_shovel,iron_axe,iron_sword,shield,bucket,shears,white_bed,chest,dirt,sand,glass,glass_pane,ladder,oak_door,spruce_door,oak_stairs,spruce_stairs,cobblestone_stairs,oak_slab,spruce_slab,cobblestone_slab,oak_fence,spruce_fence,white_wool,black_wool,gray_wool,brown_wool,black_bed,gray_bed,brown_bed'
env['JEV_PERSONA_CRAFT_FROM_INVENTORY']='1' if tolik else '0'
runs=profile/'runs'/'tolik' if tolik else profile/'runs'
run=runs/datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
run.parent.mkdir(parents=True,exist_ok=True)
env['JEV_COMMUNITY_RUN_DIRECTORY']=str(run)
# Keep logs beside this profile, never overwrite local experiment evidence.
log=run.parent/(run.name+'.log')
fd=os.open(log,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
os.dup2(fd,1);os.dup2(fd,2);os.close(fd)
os.chdir(root/'jevcraft')
os.execvpe('node',['node','scripts/community.js'],env)
