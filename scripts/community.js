'use strict';
// Separate bounded profile: never invoke from the ordinary local launcher.
const fs=require('node:fs'),path=require('node:path');
const {TypeSafe}=require('../src/typesafe'),{AttemptBudget}=require('../src/attempt-budget');
const {createSession}=require('../src/session'),{communityAuth}=require('../src/community-auth');
async function main(){
 const profile=require('../src/community-profile').communityProfile(process.env.JEV_COMMUNITY_CHARACTER||'Skipper');
 const encoded=process.env.JEV_PERSONA_PROFILE;
 if(typeof encoded!=='string'||Buffer.byteLength(encoded,'utf8')>24576)throw new Error('Configured community persona required');
 const personaProfile=JSON.parse(encoded);
 if(!require('../src/persona-context').validProfile(personaProfile)||personaProfile.persona_id!==profile.character)throw new Error('Invalid configured community persona');
 const authority=require('../src/mutation-authority'),authorityScope={worldId:profile.worldId,principal:profile.username};
 const mutationPolicy=process.env.JEV_MUTATION_AUTHORITY?authority.loadMutationAuthority(process.env.JEV_MUTATION_AUTHORITY,authorityScope):authority.validateMutationAuthority({version:1,world_id:profile.worldId,principal:profile.username,temporary_empty_placement:true,grants:[]},authorityScope);
 const rendezvous=require('../src/persona-rendezvous').validateRendezvous(process.env.JEV_COMMUNITY_RENDEZVOUS?JSON.parse(process.env.JEV_COMMUNITY_RENDEZVOUS):null);
 const directory=process.env.JEV_COMMUNITY_RUN_DIRECTORY;
 if(!directory||!path.isAbsolute(directory))throw new Error('Community run directory required');
 const seconds=Number(process.env.JEV_COMMUNITY_SECONDS||600),limit=Number(process.env.JEV_COMMUNITY_HTTP_LIMIT||60);
 if(!Number.isInteger(seconds)||seconds<1||seconds>600||!Number.isInteger(limit)||limit<1||limit>60)throw new Error('Community bounds exceed first-run policy');
 if(!process.env.MC_LOGIN_PASSWORD||!process.env.JEV_PERSONA_TOKEN)throw new Error('Community authentication/token configuration incomplete');
 const password=process.env.MC_LOGIN_PASSWORD;
 for(const method of ['log','warn','error']){const original=console[method];console[method]=(...args)=>original(...args.map(x=>String(x).split(password).join('[redacted]')));}
 fs.mkdirSync(directory,{recursive:false,mode:0o700});
 const stateDirectory=require('../src/community-profile').communityStateDirectory(profile.character,directory);
 fs.mkdirSync(stateDirectory,{recursive:true,mode:0o700});
 // Lock profile options even if the shell inherited local experiment settings.
 Object.assign(process.env,{JEV_SVC_ENABLED:process.env.JEV_SVC_ENABLED==='1'?'1':'0',JEV_SVC_PROTOCOL:'20',JEV_PROVIDER:'openrouter',OPENROUTER_JEV_MODEL:'typesafe/jev-1.14',MC_WORLD_ID:profile.worldId,JEV_PERSONA_MODE:'1',JEV_PERSONA_BUILD:profile.build?'1':'0',JEV_NO_QUIET_RESTART:'1',MC_COMMAND_USERS:'',JEV_PERSONA_PLAYERS:rendezvous?.target||'',JEV_PERSONA_PORT:String(profile.port)});
 let session,server,timer,killTimer;let stopped=false;
 function stop(reason){if(stopped)return;stopped=true;console.log(JSON.stringify({communityStop:reason}));session?.shutdown();killTimer=setTimeout(()=>process.exit(1),5000);killTimer.unref();}
 const budget=new AttemptBudget(limit,{record:event=>fs.appendFileSync(path.join(directory,'http-attempts.jsonl'),JSON.stringify(event)+'\n',{mode:0o600}),onExhausted:()=>stop('HTTP attempt cap reached')});
 const client=new TypeSafe({provider:'openrouter',model:'typesafe/jev-1.14',attemptBudget:budget});
 const config={host:'mc.agicraft.ru',port:25565,version:'1.21.11',username:profile.username,auth:'offline'};
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>stop(signal));
 timer=setTimeout(()=>stop('600-second maximum elapsed'),seconds*1000);
 try{
  server=await require('../src/persona-transport').startPersonaTransport({getSession:()=>session,token:process.env.JEV_PERSONA_TOKEN,port:profile.port});
  session=createSession(config,client,{stateDirectory,rendezvous,personaProfile,mutationPolicy,personaVisiblePlayers:true,personaLocalMove:true,personaVisit:process.env.JEV_PERSONA_VISIT==='1',authenticate:(bot,cfg)=>communityAuth(bot,cfg,{password,warpAi:process.env.JEV_COMMUNITY_WARP_AI==='1',diagnostic:event=>console.log(JSON.stringify({communityAuth:event})),allowRegister:process.env.JEV_COMMUNITY_FIRST_REGISTER==='1',successText:process.env.MC_LOGIN_SUCCESS_TEXT})});
  client.ledger=require('../src/http-usage-ledger').attachHttpUsageLedger(client.ledger,path.join(directory,'http-usage.jsonl'),{maxEntries:limit,onError:()=>stop('HTTP usage ledger unavailable')});
  const outcome=await session.closed;console.log(JSON.stringify({communityClosed:outcome,httpAttempts:budget.used,httpLimit:limit}));
 }finally{clearTimeout(timer);clearTimeout(killTimer);session?.shutdown();if(server)await new Promise(resolve=>server.close(resolve));}
}
main().then(()=>process.exit(0),()=>{console.error('Community startup or session failed; no automatic reconnect');process.exit(1)});
