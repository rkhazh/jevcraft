'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createPersona}=require('../src/persona-admission');
const {withPersonaContext}=require('../src/persona-context');
const {TypeSafe}=require('../src/typesafe');
const profile={persona_id:'traveller',identity:'Thoughtful traveller',motivations:['Make a welcoming place'],social_style:'Brief'};
function fixture(t){
 let clock=2000000000000,choice='consider',safe=false,goal=null,release=null,api;
 const packets=[],body={connected:true,health:20,food:20,dimension:'overworld',items:['oak_log'],players:[],inventory:{},position:{x:0,y:64,z:0},vision_capabilities:{enabled:false}};
 t.mock.method(Date,'now',()=>clock);
 t.mock.method(globalThis,'fetch',async(_url,args)=>{packets.push(JSON.parse(args.body));if(release)await release;return new Response(JSON.stringify({answers:{branch_0:{choice}}}),{status:200});});
 const native=new TypeSafe({apiKey:'offline-test',provider:'openrouter',maxRetries:0});
 const client=withPersonaContext(native,()=>goal,g=>api.valid(g.personaGoalId),{getProfile:()=>api.actorProfile,getSharedContext:()=>api.sharedContext});
 // Lazy loading keeps the initial RED failure an assertion on missing behavior.
 let select=null,current;
 api=createPersona({read:()=>body,worldId:'world',items:['oak_log'],start:async g=>{goal=g},stop:async()=>{goal=null},reaction:(...args)=>{select??=require('../src/persona-reaction').createPersonaReaction({client,getPersona:()=>current,getGoal:()=>goal,canObserve:()=>safe});return select(...args);}});
 current=api;api.setProfile(profile,api.sessionId);
 const context=(revision=1)=>({schema_version:1,session_id:api.sessionId,world_id:'world',persona_id:'traveller',revision,observed_at:clock/1000,short_term:{messages:[{source:{event_id:'interaction',text:'Could we use birch?'}}],pending_interactions:[]},medium_term:{current_work:'An unfinished platform'},long_term:{relevant_memory:['The previous material was spruce.']}});
 api.setSharedContext(context(),api.sessionId);
 const request=(phase='attention',draft=null)=>({context_revision:api.sharedContext?.revision??1,source_event_id:'interaction',phase,draft});
 const submit=async()=>{const s=api.snapshot();return api.submit({schema_version:1,goal_id:randomUUID(),persona_id:'traveller',session_id:s.session_id,observation_id:s.observation_id,issued_at:clock/1000,expires_at:clock/1000+60,state:'proposed',spec:{kind:'obtain',item:'oak_log',count:1,deliver:false}});};
 return {api,body,packets,context,request,submit,setChoice:v=>{choice=v},setSafe:v=>{safe=v},advance:ms=>{clock+=ms},block:promise=>{release=promise},replace:v=>{current=v}};
}

test('native attention uses real typed classifier and shared memory, without creating work or speech',async t=>{
 const f=fixture(t);assert.deepEqual(f.api.snapshot().reaction_capabilities,{enabled:true});
 const result=await f.api.react(f.request(),f.api.sessionId);
 assert.deepEqual(result,{status:'selected',choice:'consider',session_id:f.api.sessionId,context_revision:1,source_event_id:'interaction'});
 assert.equal(f.api.snapshot().active_goal_id,null);
 const wire=f.packets[0];assert.deepEqual(Object.keys(wire.questions.branch_0.criteria).sort(),['consider','wait']);
 assert.equal(wire.state.shared_context.short_term.messages[0].source.text,'Could we use birch?');
 assert.deepEqual(wire.state.shared_context.long_term.relevant_memory,['The previous material was spruce.']);
 assert.match(wire.questions.branch_0.criteria.wait,/does not accept|does not complete/);
 f.setChoice('speak');const speech=await f.api.react(f.request('speech','I remember your material request.'),f.api.sessionId);
 assert.equal(speech.choice,'speak');assert.deepEqual(Object.keys(f.packets.at(-1).questions.branch_0.criteria).sort(),['silent','speak']);
 assert.equal(f.packets.at(-1).state.reaction.draft,'I remember your material request.');
 assert.equal(f.api.snapshot().active_goal_id,null);await f.api.close();
});

test('reaction validates source membership, phase, draft and exact fresh revision before spending a model attempt',async t=>{
 const f=fixture(t);assert.equal(typeof f.api.react,'function');
 const request=f.request();
 for(const data of [{...request,extra:true},{...request,context_revision:2},{...request,context_revision:0},{...request,source_event_id:'unknown'},
  {...request,phase:'attack'},{...request,draft:'not null'},...['','/op Alex','two\nlines','x'.repeat(241)].map(draft=>({...request,phase:'speech',draft}))]){
  assert.equal((await f.api.react(data,f.api.sessionId)).status,'rejected');
 }
 assert.equal((await f.api.react(request,'old')).status,'rejected');assert.equal(f.packets.length,0);
 const c=f.context(2);c.short_term.messages=[];c.short_term.pending_interactions=[{event_id:'pending'}];f.api.setSharedContext(c,f.api.sessionId);
 assert.equal((await f.api.react({...f.request(),source_event_id:'pending'},f.api.sessionId)).status,'selected');
 f.advance(30001);assert.equal((await f.api.react({...request,context_revision:2},f.api.sessionId)).status,'rejected');
 assert.equal(f.packets.length,1);await f.api.close();
});

test('observe is offered only with safe available idle vision, no usable capture, and an elapsed selection cooldown',async t=>{
 const f=fixture(t);assert.equal(typeof f.api.react,'function');
 const offered=async()=>{await f.api.react(f.request(),f.api.sessionId);return Object.keys(f.packets.at(-1).questions.branch_0.criteria)};
 assert.ok(!(await offered()).includes('observe'));
 f.body.vision_capabilities.enabled=true;assert.ok(!(await offered()).includes('observe'));
 f.setSafe(true);assert.ok((await offered()).includes('observe'));
 const c=f.context(2);c.short_term.capture={capture_id:'view',session_id:f.api.sessionId,world_id:'world',dimension:'overworld',active_goal_id:null,observed_at:Date.now()/1000,position:{x:0,y:64,z:0}};
 f.api.setSharedContext(c,f.api.sessionId);assert.ok(!(await offered()).includes('observe'));
 f.advance(5001);f.api.setSharedContext(f.context(3),f.api.sessionId);f.setChoice('observe');
 assert.equal((await f.api.react(f.request(),f.api.sessionId)).choice,'observe');
 f.setChoice('wait');assert.ok(!(await offered()).includes('observe'));
 f.advance(5000);assert.ok((await offered()).includes('observe'));
 const goal=await f.submit();assert.equal(goal.status,'accepted');assert.ok(!(await offered()).includes('observe'));
 assert.ok((await offered()).includes('continue'));await f.api.cancel(goal.goal_id);assert.ok(!(await offered()).includes('continue'));
 await f.api.close();
});

test('late selections cannot survive context replacement, session replacement, closure or cancelled work',async t=>{
 const f=fixture(t);assert.equal(typeof f.api.react,'function');
 for(const change of ['context','cancel','session','close']){
  if(change==='session')f.replace(f.api);
  let release;f.block(new Promise(resolve=>{release=resolve}));
  const goal=change==='cancel'?await f.submit():null;f.setChoice(goal?'continue':'consider');
  const before=f.packets.length,pending=f.api.react(f.request(),f.api.sessionId);
  while(f.packets.length===before)await new Promise(resolve=>setImmediate(resolve));
  if(change==='context')f.api.setSharedContext(f.context(2),f.api.sessionId);
  if(change==='cancel')await f.api.cancel(goal.goal_id);
  if(change==='session')f.replace({sessionId:'replacement'});
  if(change==='close'){f.replace(f.api);await f.api.close();}
  release();assert.equal((await pending).status,'rejected');f.block(null);
  if(change==='session')f.replace(f.api);
 }
});

test('unoffered model answers fail closed instead of selecting a fallback',async t=>{
 const f=fixture(t);assert.equal(typeof f.api.react,'function');f.setChoice('attack');
 assert.equal((await f.api.react(f.request(),f.api.sessionId)).status,'rejected');
 assert.equal(f.api.snapshot().active_goal_id,null);await f.api.close();
});

test('reaction ignores malformed optional history containers and accepts only recognized source slots',async t=>{
 const f=fixture(t),context=f.context(2);
 context.short_term.messages={source:{event_id:'forged-container'}};
 context.short_term.pending_interactions=null;context.short_term.event={event_id:'current-event'};
 assert.equal(f.api.setSharedContext(context,f.api.sessionId).status,'ready');
 assert.equal((await f.api.react({...f.request(),source_event_id:'forged-container'},f.api.sessionId)).reason,'unknown_source_event');
 assert.equal((await f.api.react({...f.request(),source_event_id:'current-event'},f.api.sessionId)).choice,'consider');
 assert.equal(f.packets.length,1);await f.api.close();
});

test('reaction endpoint authenticates and fences the session after a delayed classifier result',async()=>{
 const {startPersonaTransport}=require('../src/persona-transport');let release,calls=0;
 const api={sessionId:'current',react:async()=>{calls++;await new Promise(resolve=>{release=resolve});return {status:'selected',choice:'wait'}}};
 let current=api;const token='reaction-test-offline-token-123456789';
 const server=await startPersonaTransport({port:0,token,getSession:()=>({persona:current})});
 try{
  const url=`http://127.0.0.1:${server.address().port}/reaction`,headers={Authorization:'Bearer '+token,'X-Persona-Session':'current'},body=JSON.stringify({context_revision:1,source_event_id:'event',phase:'attention',draft:null});
  assert.equal((await fetch(url,{method:'POST',body})).status,401);
  assert.equal((await fetch(url,{method:'POST',headers:{...headers,'X-Persona-Session':'old'},body})).status,409);
  assert.equal(calls,0);const pending=fetch(url,{method:'POST',headers,body});while(!release)await new Promise(resolve=>setImmediate(resolve));
  current={sessionId:'replacement'};release();assert.equal((await pending).status,409);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
