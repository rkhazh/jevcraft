"""Isolated bounded community profile. Does not register accounts or run admin commands."""
import os
from datetime import datetime, timezone
from pathlib import Path
from dotenv import dotenv_values
root=Path(__file__).resolve().parents[2]
profile=root/'setup/jevcraft-community'
private=dotenv_values(profile/'private.env')
key=private.get('OPENROUTER_API_KEY') or dotenv_values(root/'NetTyan/.env').get('OPENROUTER_API_KEY')
if not key: raise SystemExit('Configured OpenRouter key unavailable')
# Deliberately do not inherit local house goals, voice endpoints or profile settings.
env={k:v for k,v in os.environ.items() if k in {'PATH','HOME','TMPDIR','LANG','LC_ALL'}}
for k in ['MC_LOGIN_PASSWORD','MC_LOGIN_SUCCESS_TEXT','JEV_PERSONA_TOKEN']:
 if not private.get(k): raise SystemExit(f'Missing community configuration: {k}')
 env[k]=private[k]
env.update(OPENROUTER_API_KEY=key,JEV_COMMUNITY_SECONDS='600',JEV_COMMUNITY_HTTP_LIMIT='60',JEV_PERSONA_ITEMS='oak_log,spruce_log,birch_log,cobblestone,crafting_table,wooden_pickaxe,stone_pickaxe,coal,torch,oak_planks,spruce_planks,birch_planks,stick,furnace,raw_iron,iron_ingot,iron_pickaxe,stone_axe,bread,cooked_beef,charcoal')
run=profile/'runs'/datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
run.parent.mkdir(parents=True,exist_ok=True)
env['JEV_COMMUNITY_RUN_DIRECTORY']=str(run)
# Keep logs beside this profile, never overwrite local experiment evidence.
log=run.parent/(run.name+'.log')
fd=os.open(log,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
os.dup2(fd,1);os.dup2(fd,2);os.close(fd)
os.chdir(root/'jevcraft')
os.execvpe('node',['node','scripts/community.js'],env)
