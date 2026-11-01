'use strict';
// Separate bounded profile: never invoke from the ordinary local launcher.
const fs=require('node:fs'),path=require('node:path');
const {TypeSafe}=require('../src/typesafe'),{AttemptBudget}=require('../src/attempt-budget');
const {createSession}=require('../src/session'),{communityAuth}=require('../src/community-auth');
async function main(){
 const directory=process.env.JEV_COMMUNITY_RUN_DIRECTORY;
 if(!directory||!path.isAbsolute(directory))throw new Error('Community run directory required');
 const seconds=Number(process.env.JEV_COMMUNITY_SECONDS||600),limit=Number(process.env.JEV_COMMUNITY_HTTP_LIMIT||60);
 if(!Number.isInteger(seconds)||seconds<1||seconds>600||!Number.isInteger(limit)||limit<1||limit>60)throw new Error('Community bounds exceed first-run policy');
 if(!process.env.MC_LOGIN_PASSWORD||!process.env.MC_LOGIN_SUCCESS_TEXT||!process.env.JEV_PERSONA_TOKEN)throw new Error('Community authentication/token configuration incomplete');
 const password=process.env.MC_LOGIN_PASSWORD;
 for(const method of ['log','warn','error']){const original=console[method];console[method]=(...args)=>original(...args.map(x=>String(x).split(password).join('[redacted]')));}
 fs.mkdirSync(directory,{recursive:false,mode:0o700});
 // Lock profile options even if the shell inherited local experiment settings.
 Object.assign(process.env,{JEV_PROVIDER:'openrouter',OPENROUTER_JEV_MODEL:'typesafe/jev-1.14',MC_WORLD_ID:'agicraft-community-1_21_11',JEV_PERSONA_MODE:'1',JEV_PERSONA_BUILD:'0',JEV_NO_QUIET_RESTART:'1',MC_COMMAND_USERS:'',JEV_PERSONA_PLAYERS:'',JEV_PERSONA_PORT:'8769'});
 let session,server,timer,killTimer;let stopped=false;
 function stop(reason){if(stopped)return;stopped=true;console.log(JSON.stringify({communityStop:reason}));session?.shutdown();killTimer=setTimeout(()=>process.exit(1),5000);killTimer.unref();}
 const budget=new AttemptBudget(limit,{record:event=>fs.appendFileSync(path.join(directory,'http-attempts.jsonl'),JSON.stringify(event)+'\n',{mode:0o600}),onExhausted:()=>stop('HTTP attempt cap reached')});
 const client=new TypeSafe({provider:'openrouter',model:'typesafe/jev-1.14',attemptBudget:budget});
 const config={host:'mc.agicraft.ru',port:25565,version:'1.21.11',username:'SkipperJev',auth:'offline'};
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>stop(signal));
 timer=setTimeout(()=>stop('600-second maximum elapsed'),seconds*1000);
 try{
  session=createSession(config,client,{stateDirectory:path.join(directory,'state'),authenticate:(bot,cfg)=>communityAuth(bot,cfg,{password,successText:process.env.MC_LOGIN_SUCCESS_TEXT})});
  server=await require('../src/persona-transport').startPersonaTransport({getSession:()=>session,token:process.env.JEV_PERSONA_TOKEN,port:8769});
  const outcome=await session.closed;console.log(JSON.stringify({communityClosed:outcome,httpAttempts:budget.used,httpLimit:limit}));
 }finally{clearTimeout(timer);clearTimeout(killTimer);session?.shutdown();if(server)await new Promise(resolve=>server.close(resolve));}
}
main().then(()=>process.exit(0),()=>{console.error('Community startup or session failed; no automatic reconnect');process.exit(1)});
