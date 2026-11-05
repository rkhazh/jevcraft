'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{Vec3}=require('vec3');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),Module=require('node:module');
const profile=()=>({persona_id:'configured-traveller',identity:'Exact configured identity.\n'+ 'Character detail. '.repeat(25),motivations:['Respect shared property.'],social_style:'Brief character voice.'});
const until=async check=>{for(let i=0;i<200;i++){if(check())return;await new Promise(r=>setTimeout(r,5));}assert.fail('Offline bootstrap did not settle');};

async function sessionFixture(run,{idleCleanup}={}){
 const bot=new EventEmitter();bot._client=new EventEmitter();bot._client.write=()=>{};
 Object.assign(bot,{loadPlugin(){},username:'Traveller',version:'26.1',health:20,food:20,isAlive:true,registry:{itemsByName:{}},
  game:{dimension:'overworld',gameMode:'survival'},time:{timeOfDay:1000},players:{},entities:{},entity:{position:new Vec3(.5,64,.5)},inventory:{items:()=>[]},
  pathfinder:{setGoal(){}},clearControlStates(){},stopDigging(){},deactivateItem(){},chat(){},quit(){bot.emit('end','quit');},waitForChunksToLoad:async()=>{},blockAt:()=>null});
 const seen=[];let connections=0,survival,session;
 const original=Module._load,oldEnv={...process.env},dir=fs.mkdtempSync(path.join(os.tmpdir(),'jev-profile-bootstrap-'));
 const filename=require.resolve('../src/session');delete require.cache[filename];
 Module._load=function(name,parent,isMain){
  if(name==='mineflayer')return {createBot:()=>{connections++;return bot;}};
  if(name==='./movement'&&parent.filename===filename)return {configureMovements(){}};
  if(name==='./lava-escape')return {settleAfterJoin:async()=>{}};
  if(name==='./slow-calls')return {install(){}};
  if(name==='./work'&&parent.filename===filename)return {
   createSurvival:(_bot,options)=>(survival={state:{},client:options.client}),
   runGoal:async()=>{seen.push({workStarted:true,sneak:bot.controlState?.sneak,setter:bot.setControlState});},
   runIdle:async(_bot,task)=>{
    await survival.client.systemOne({state:{phase:'first_survival'},questions:{}});
    while(!task.cancelled)await new Promise(r=>setTimeout(r,5));
    if(idleCleanup)await idleCleanup(bot);
   }
  };
  return original.call(this,name,parent,isMain);
 };
 Object.assign(process.env,{JEV_PERSONA_MODE:'1',JEV_NO_QUIET_RESTART:'1'});
 try{
  const create=options=>(session=require('../src/session').createSession({host:'localhost',port:25565,username:'Traveller'},{systemOne:async args=>seen.push(args)},{stateDirectory:dir,runLedger:null,...options}));
  await run({bot,seen,create,connections:()=>connections});
 }finally{session?.shutdown();await session?.closed;Module._load=original;delete require.cache[filename];process.env=oldEnv;fs.rmSync(dir,{recursive:true,force:true});}
}

test('first survival decision receives full configured identity before any HTTP profile handshake',async()=>sessionFixture(async({bot,seen,create})=>{
 const expected=profile(),input=structuredClone(expected),session=create({personaProfile:input});
 input.identity='mutated caller';bot.emit('spawn');await until(()=>seen.length);
 for(const [key,value] of Object.entries(expected))assert.deepEqual(seen[0].state.actor_profile?.[key],value);
 assert.equal(seen[0].state.persona_context,undefined);
 assert.equal(session.persona.setProfile(expected,session.persona.sessionId).status,'ready');
 assert.equal(session.persona.setProfile({...expected,identity:'different'},session.persona.sessionId).reason,'profile_already_set');
}));

test('invalid bootstrap identity fails before creating a Minecraft connection and does not echo profile data',async()=>sessionFixture(async({create,connections})=>{
 assert.throws(()=>create({personaProfile:{...profile(),identity:'secret-profile-value',objective:'extra authority'}}),error=>!error.message.includes('secret-profile-value'));
 assert.equal(connections(),0);
}));

test('standalone callers without a bootstrap profile retain immediate survival scheduling',async()=>sessionFixture(async({bot,seen,create})=>{
 create({});bot.emit('spawn');await until(()=>seen.length);
 assert.equal(seen[0].state.phase,'first_survival');assert.equal(seen[0].state.actor_profile,undefined);
}));

test('local movement opt-in does not enable the wider visit capability',async()=>sessionFixture(async({bot,seen,create})=>{
 process.env.JEV_PERSONA_VISIT='1';
 const session=create({personaLocalMove:true});bot.emit('spawn');await until(()=>seen.length);
 assert.equal(session.persona.snapshot().movement_capabilities.local_move.enabled,true);
 assert.equal(session.persona.snapshot().movement_capabilities.visit.enabled,false);
}));

test('explicit visit session option publishes only recorded bounded references after readiness',async()=>sessionFixture(async({bot,seen,create})=>{
 const session=create({personaVisit:true});
 bot.buildRegistry.state.builds.push({id:'recorded-project',name:'Known room',dimension:'overworld',entrance:{x:8.5,y:64,z:.5},updatedAt:'2026-11-04T00:00:00Z'});
 assert.equal(session.persona.snapshot().movement_capabilities.visit.enabled,false);
 bot.emit('spawn');await until(()=>seen.length);
 const cap=session.persona.snapshot().movement_capabilities.visit;
 assert.equal(cap.enabled,true);assert.equal(cap.destinations[0].id,'project:recorded-project');assert.equal(cap.destinations[0].access,'unverified');assert.equal(cap.max_distance,96);
}));

test('actual persona session handoff retains protective crouch through native reset and delayed idle cleanup',async()=>sessionFixture(async({bot,seen,create})=>{
 const {randomUUID}=require('node:crypto'),Block=require('prismarine-block')('1.21.11');bot.registry=require('minecraft-data')('1.21.11');bot.version='1.21.11';
 Object.assign(bot.entity,{position:new Vec3(1.1,64,.5),onGround:true,height:1.8,width:.6,effects:{}});
 bot.blockAt=p=>{const q=p.floored(),b=Block.fromStateId(bot.registry.blocksByName[q.y<=40||q.x===0&&q.y===63?'stone':'air'].defaultState,0);b.position=q;return b;};
 bot.controlState={sneak:true,forward:true};const setter=bot.setControlState=(k,v)=>{bot.controlState[k]=v;};bot.clearControlStates=()=>{for(const k of Object.keys(bot.controlState))bot.setControlState(k,false);};
 const session=create({personaVisit:true});require('mineflayer-pathfinder').pathfinder(bot);
 bot.buildRegistry.state.builds.push({id:'reference',name:'Known place',dimension:'overworld',entrance:{x:9.5,y:64,z:.5}});
 bot.emit('spawn');await until(()=>seen.length);bot.setControlState('sneak',true);bot.setControlState('forward',true);
 const s=session.persona.snapshot(),now=Date.now()/1000,p={schema_version:1,goal_id:randomUUID(),persona_id:'actor',session_id:s.session_id,observation_id:s.observation_id,issued_at:now,expires_at:now+60,state:'proposed',spec:{kind:'visit',target:'project:reference'}};
 assert.equal((await session.persona.submit(p)).status,'accepted');await until(()=>seen.some(e=>e.workStarted));
 const started=seen.find(e=>e.workStarted);assert.equal(started.sneak,true);assert.equal(started.setter,setter);assert.equal(bot.controlState.forward,false);
},{idleCleanup:async bot=>{await new Promise(r=>setTimeout(r,10));bot.clearControlStates();bot.setControlState('sneak',false);}}));

test('invalid shared-world authority fails before connection',async()=>sessionFixture(async({create,connections})=>{
 assert.throws(()=>create({mutationPolicy:{version:1,world_id:'another-world'}}),/mutation policy/);
 assert.equal(connections(),0);
}));

test('authority activates with authenticated gameplay, reaches both models and closes with the session',async()=>sessionFixture(async({bot,seen,create})=>{
 process.env.MC_WORLD_ID='offline-shared-world';
 const policy={version:1,world_id:'offline-shared-world',principal:'Traveller',temporary_empty_placement:true,grants:[]};
 const authority=require('../src/mutation-authority');
 bot.blockAt=p=>({name:'air',stateId:0,position:p,getProperties:()=>({})});
 const session=create({personaProfile:profile(),mutationPolicy:policy});
 assert.equal(authority.queryMutation(bot,'place',{x:0,y:64,z:0}).allowed,false);
 assert.equal(session.persona.snapshot().mutation_authority.active,false);
 bot.emit('spawn');await until(()=>seen.length);
 assert.equal(authority.queryMutation(bot,'place',{x:0,y:64,z:0}).allowed,true);
 assert.deepEqual(seen[0].state.mutation_authority,session.persona.snapshot().mutation_authority);
 assert.equal(seen[0].state.mutation_authority.active,true);
 session.shutdown();await session.closed;
 assert.equal(authority.queryMutation(bot,'place',{x:0,y:64,z:0}).allowed,false);
 assert.equal(session.persona.snapshot().mutation_authority.active,false);
}));

async function communityLaunch(encoded){
 const env={JEV_COMMUNITY_CHARACTER:'Skipper',JEV_PERSONA_PROFILE:encoded,JEV_COMMUNITY_RUN_DIRECTORY:'/offline/isolated-run',MC_LOGIN_PASSWORD:'offline-password',JEV_PERSONA_TOKEN:'offline-token'};
 const sessions=[],errors=[];let finish;
 const ended=new Promise(resolve=>{finish=resolve;});
 const localRequire=name=>{
  if(name==='node:fs')return {mkdirSync(){}};
  if(name==='../src/typesafe')return {TypeSafe:class {constructor(){this.ledger={};}}};
  if(name==='../src/session')return {createSession:(_config,_client,options)=>{sessions.push(options);return {closed:Promise.resolve({}),shutdown(){}};}};
  if(name==='../src/persona-transport')return {startPersonaTransport:async()=>({close:callback=>callback()})};
  if(name==='../src/http-usage-ledger')return {attachHttpUsageLedger:value=>value};
  return require(name);
 };
 require('node:vm').runInNewContext(fs.readFileSync(path.join(__dirname,'../scripts/community.js'),'utf8'),{
  require:localRequire,Buffer,setTimeout,clearTimeout,
  console:{log(){},warn(){},error:value=>errors.push(value)},process:{env,once(){},exit:code=>finish(code)}
 });
 return {code:await ended,sessions,errors};
}

test('community entry point passes validated local identity into session creation',async()=>{
 const expected={...profile(),persona_id:'Skipper'},result=await communityLaunch(JSON.stringify(expected));
 assert.equal(result.code,0);assert.equal(result.sessions.length,1);
 assert.deepEqual(JSON.parse(JSON.stringify(result.sessions[0].personaProfile)),expected);
 assert.equal(result.sessions[0].mutationPolicy.temporary_empty_placement,true);
 assert.equal(result.sessions[0].mutationPolicy.grants.length,0);
});

test('community entry point rejects missing, malformed, mismatched and oversized profiles before connecting',async()=>{
 for(const encoded of [undefined,'{"secret-private-value":',JSON.stringify(profile()),JSON.stringify({...profile(),persona_id:'Skipper',identity:'x'.repeat(25000)})]){
  const result=await communityLaunch(encoded);
  assert.equal(result.code,1);assert.equal(result.sessions.length,0);
  assert.ok(!result.errors.join(' ').includes('secret-private-value'));
 }
});
