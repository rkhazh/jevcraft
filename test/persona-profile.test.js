'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createPersona}=require('../src/persona-admission');
const {withPersonaContext,validProfile}=require('../src/persona-context');
const profile=()=>({persona_id:'traveller',identity:'A thoughtful traveller.\n'+ 'Identity detail. '.repeat(20)+'Respect shared property.',motivations:['Create a welcoming place'],social_style:'Brief and grounded'});
const fixture=()=>createPersona({read:()=>({connected:true,health:20,dimension:'overworld',items:['oak_log'],players:[],inventory:{}}),items:['oak_log'],start:async()=>{},stop:async()=>{}});

test('standing profile preserves full configured identity but cannot contain an objective or authority',()=>{
 assert.equal(validProfile(profile()),true);
 for(const p of [{...profile(),objective:'do this now'},{...profile(),persona_id:''},{...profile(),identity:'x'.repeat(16001)},{...profile(),identity:42},{...profile(),motivations:Array(11).fill('a')},{...profile(),identity:'Я'.repeat(15000)}])assert.equal(validProfile(p),false);
});

test('profile is immutable and idempotent per session, and never admits an action',async()=>{
 const api=fixture(),id=api.sessionId,p=profile();
 assert.deepEqual(api.snapshot().actor_profile,{supported:true,persona_id:null});
 assert.equal(api.setProfile(p,'old').status,'rejected');assert.equal(api.actorProfile,null);
 assert.equal(api.setProfile({...p,objective:'new permission'},id).status,'rejected');
 assert.deepEqual(api.setProfile(p,id),{status:'ready',session_id:id,persona_id:p.persona_id});
 assert.equal(api.setProfile(profile(),id).status,'ready');
 p.identity='changed';assert.notEqual(api.actorProfile.identity,'changed');
 const copy=api.actorProfile;copy.motivations.push('changed');assert.equal(api.actorProfile.motivations.length,1);
 assert.equal(api.setProfile(p,id).reason,'profile_already_set');
 const s=api.snapshot();assert.equal(s.active_goal_id,null);
 const ack=await api.submit({schema_version:1,goal_id:randomUUID(),persona_id:'other',session_id:id,observation_id:s.observation_id,issued_at:Date.now()/1000,expires_at:Date.now()/1000+60,state:'proposed',spec:{kind:'obtain',item:'oak_log',count:1,deliver:false}});
 assert.equal(ack.reason,'wrong_persona');
 await api.close();assert.equal(api.actorProfile,null);assert.equal(api.setProfile(profile(),id).status,'rejected');
});

test('idle tactics retain standing identity without retaining expired task context',async()=>{
 const api=fixture(),seen=[];api.setProfile(profile(),api.sessionId);
 let current=true;
 const goal={personaGoalId:'task',kind:'obtain',request:'Get material',personaContext:{identity:'brief identity',motivations:[],objective:'temporary objective',intention:'temporary focus',purpose:'temporary purpose',visual_assessment:null}};
 const client=withPersonaContext({systemOne:async args=>seen.push(args)},()=>goal,()=>current,{getProfile:()=>api.actorProfile});
 const ask=()=>client.systemOne({state:{actor_profile:{identity:'injected'},persona_context:{objective:'injected'}},questions:{}});
 await ask();assert.match(seen[0].state.actor_profile.identity,/Respect shared property/);assert.equal(seen[0].state.persona_context.objective,'temporary objective');
 assert.equal(seen[0].state.persona_context.identity,undefined);assert.equal(seen[0].state.persona_context.motivations,undefined);
 current=false;await ask();assert.equal(seen[1].state.persona_context,undefined);assert.equal(seen[1].state.actor_profile.persona_id,'traveller');assert.ok(!JSON.stringify(seen[1]).includes('temporary'));
 await api.close();await ask();assert.equal(seen[2].state.actor_profile,undefined);assert.ok(!JSON.stringify(seen[2]).includes('injected'));
});

test('actual tactical request preserves the full profile after request compaction',async t=>{
 const {TypeSafe}=require('../src/typesafe'),packets=[],p=profile();
 t.mock.method(globalThis,'fetch',async(_url,args)=>{packets.push(JSON.parse(args.body));return new Response(JSON.stringify({answers:{}}),{status:200});});
 const client=withPersonaContext(new TypeSafe({apiKey:'offline-test',provider:'openrouter',maxRetries:0}),()=>null,()=>false,{getProfile:()=>p});
 await client.systemOne({state:{health:20},questions:{}});
 for(const k of ['persona_id','identity','motivations','social_style'])assert.deepEqual(packets[0].state.actor_profile[k],p[k]);
 assert.equal(packets[0].state.persona_context,undefined);
});

test('profile bridge requires authentication and current session, without granting a goal',async()=>{
 const {startPersonaTransport}=require('../src/persona-transport');
 const api=fixture(),token='offline-test-persona-profile-token-123456';
 const server=await startPersonaTransport({getSession:()=>({persona:api}),token,port:0});
 try{
  const url=`http://127.0.0.1:${server.address().port}/persona-profile`;
  const send=(headers,data=profile())=>fetch(url,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(data)});
  assert.equal((await send({'X-Persona-Session':api.sessionId})).status,401);
  assert.equal((await send({Authorization:'Bearer '+token,'X-Persona-Session':'old'})).status,409);
  const result=await send({Authorization:'Bearer '+token,'X-Persona-Session':api.sessionId});
  assert.equal(result.status,200);assert.equal((await result.json()).status,'ready');
  assert.equal(api.snapshot().active_goal_id,null);assert.equal(api.actorProfile.identity,profile().identity);
 }finally{await api.close();await new Promise(resolve=>server.close(resolve));}
});
