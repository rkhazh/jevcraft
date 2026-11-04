"""Isolated bounded community profile. Registration requires explicit opt-in; no admin commands."""
import os
import argparse
from datetime import datetime, timezone
from pathlib import Path
from dotenv import dotenv_values
parser=argparse.ArgumentParser()
parser.add_argument('--voice',action='store_true',help='Enable SVC handshake and authenticated voice metadata')
parser.add_argument('--character',choices=['Skipper','TolikScheben'],default='Skipper')
parser.add_argument('--first-register',action='store_true',help='Allow one registration command when the trusted server requests it')
parser.add_argument('--warp-ai',action='store_true',help='Warp once to the server ai destination before gameplay')
args=parser.parse_args()
root=Path(__file__).resolve().parents[2]
profile=root/'setup/jevcraft-community'
tolik=args.character=='TolikScheben'
private=dotenv_values(profile/('tolik-private.env' if tolik else 'private.env'))
key=private.get('OPENROUTER_API_KEY') or dotenv_values(root/'NetTyan/.env').get('OPENROUTER_API_KEY')
if not key: raise SystemExit('Configured OpenRouter key unavailable')
# Deliberately do not inherit local house goals, voice endpoints or profile settings.
env={k:v for k,v in os.environ.items() if k in {'PATH','HOME','TMPDIR','LANG','LC_ALL'}}
for k in ['MC_LOGIN_PASSWORD','JEV_PERSONA_TOKEN']:
 if not private.get(k): raise SystemExit(f'Missing community configuration: {k}')
 env[k]=private[k]
if private.get('MC_LOGIN_SUCCESS_TEXT'): env['MC_LOGIN_SUCCESS_TEXT']=private['MC_LOGIN_SUCCESS_TEXT']
env.update(JEV_COMMUNITY_WARP_AI='1' if args.warp_ai else '0',JEV_COMMUNITY_CHARACTER=args.character,JEV_COMMUNITY_FIRST_REGISTER='1' if args.first_register else '0',JEV_SVC_ENABLED='1' if args.voice else '0',OPENROUTER_API_KEY=key,JEV_COMMUNITY_SECONDS='600',JEV_COMMUNITY_HTTP_LIMIT='60',JEV_PERSONA_ITEMS='oak_log,spruce_log,birch_log,cobblestone,crafting_table,wooden_pickaxe,stone_pickaxe,coal,torch,oak_planks,spruce_planks,birch_planks,stick,furnace,raw_iron,iron_ingot,iron_pickaxe,stone_axe,bread,cooked_beef,charcoal')
if tolik: env['JEV_PERSONA_ITEMS']+=',stone,stone_shovel,iron_axe,iron_sword,shield,bucket,shears,white_bed,chest,dirt,sand,glass,glass_pane,ladder,oak_door,spruce_door,oak_stairs,spruce_stairs,cobblestone_stairs,oak_slab,spruce_slab,cobblestone_slab,oak_fence,spruce_fence,white_wool,black_wool,gray_wool,brown_wool,black_bed,gray_bed,brown_bed'
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
