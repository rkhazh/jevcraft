'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createPersona}=require('../src/persona-admission');
const {withPersonaContext}=require('../src/persona-context');
const {TypeSafe}=require('../src/typesafe');
const {decideTree}=require('../src/decisions/tree');
const profile={persona_id:'traveller',identity:'A thoughtful traveller',motivations:['Make a welcoming place'],social_style:'Brief'};
const body={connected:true,health:20,dimension:'overworld',items:['oak_log'],players:[],inventory:{}};
function fixture(options={}) {return createPersona({read:()=>body,worldId:'world-a',items:['oak_log'],start:async()=>{},stop:async()=>{},...options});}
function context(api,revision=1,observedAt=Date.now()/1000) {return {schema_version:1,session_id:api.sessionId,world_id:'world-a',persona_id:'traveller',revision,observed_at:observedAt,short_term:{incoming_messages:[{speaker:'Alex',text:'Sorry, that was an accident.'}]},medium_term:{current_work:'Consider the unfinished platform'},long_term:{relevant_memory:['Alex previously requested birch.']}};}
function install(api){assert.equal(api.setProfile(profile,api.sessionId).status,'ready');}
function proposal(api){const s=api.snapshot(),now=Date.now()/1000;return {schema_version:1,session_id:s.session_id,observation_id:s.observation_id,goal_id:randomUUID(),persona_id:'traveller',issued_at:now,expires_at:now+60,state:'proposed',spec:{kind:'obtain',item:'oak_log',count:1,deliver:false}};}

test('shared memory is profile-bound and session/world-fenced without admitting goals or capabilities',async()=>{
 const api=fixture(),c=context(api),id=api.sessionId;
 assert.deepEqual(api.snapshot().shared_context,{supported:true,revision:0});
 assert.equal(api.setSharedContext(c,id).reason,'profile_required');install(api);
 assert.equal(api.setSharedContext(c,'previous').reason,'wrong_session');
 assert.equal(api.setSharedContext({...c,session_id:'previous'},id).reason,'wrong_session');
 assert.equal(api.setSharedContext({...c,world_id:'other'},id).reason,'wrong_world');
 assert.equal(api.setSharedContext({...c,persona_id:'other'},id).reason,'wrong_persona');
 c.short_term.permissions={allow_commands:true,allow_local_move:true};
 const before=api.snapshot();
 assert.deepEqual(api.setSharedContext(c,id),{status:'ready',session_id:id,revision:1});
 const after=api.snapshot();
 assert.deepEqual(after.shared_context,{supported:true,revision:1});
 assert.deepEqual(after.actor_profile,{supported:true,persona_id:'traveller'});
 assert.equal(after.active_goal_id,null);assert.deepEqual(after.items,before.items);
 assert.deepEqual(after.movement_capabilities,before.movement_capabilities);
 assert.deepEqual(after.craft_capabilities,before.craft_capabilities);
 assert.equal((await api.submit({...proposal(api),spec:{kind:'move',target:{x:3,y:64,z:0}}})).reason,'unsupported_move');
 await api.close();assert.equal(api.sharedContext,null);
 assert.equal(api.setSharedContext(c,id).reason,'wrong_session');
 const replacement=fixture();install(replacement);
 assert.equal(replacement.sharedContext,null);assert.equal(replacement.snapshot().shared_context.revision,0);
 assert.equal(replacement.setSharedContext(c,replacement.sessionId).reason,'wrong_session');await replacement.close();
});

test('shared updates replace atomically, reject replay conflicts and isolate every caller clone',async()=>{
 const api=fixture();install(api);const c=context(api),id=api.sessionId;
 assert.equal(api.setSharedContext(c,id).status,'ready');
 const reordered=Object.fromEntries(Object.entries(c).reverse());
 assert.equal(api.setSharedContext(reordered,id).status,'ready');
 c.short_term.incoming_messages[0].text='caller mutation';
 assert.equal(api.sharedContext.short_term.incoming_messages[0].text,'Sorry, that was an accident.');
 const copy=api.sharedContext;copy.long_term.relevant_memory[0]='getter mutation';
 assert.equal(api.sharedContext.long_term.relevant_memory[0],'Alex previously requested birch.');
 assert.equal(api.setSharedContext(c,id).reason,'revision_conflict');
 const next=context(api,3);next.short_term={incoming_messages:[{text:'Please use spruce instead.'}]};
 assert.equal(api.setSharedContext(next,id).status,'ready');
 assert.equal(api.setSharedContext(context(api,2),id).reason,'stale_revision');
 assert.equal(api.sharedContext.revision,3);assert.equal(api.sharedContext.short_term.incoming_messages[0].text,'Please use spruce instead.');
 const goal=proposal(api);assert.equal((await api.submit(goal)).status,'accepted');
 await api.cancel(goal.goal_id);assert.equal(api.sharedContext.revision,3);
 await api.close();
});

test('shared updates require fresh timestamps and expire independently of goal lifetime',async t=>{
 let clock=2000000000000;t.mock.method(Date,'now',()=>clock);
 const api=fixture();install(api);const c=context(api),id=api.sessionId;
 assert.equal(api.setSharedContext({...c,observed_at:clock/1000-10.001},id).reason,'expired');
 assert.equal(api.setSharedContext({...c,observed_at:clock/1000+1.001},id).reason,'expired');
 assert.equal(api.setSharedContext({...c,observed_at:clock/1000-10},id).status,'ready');
 clock+=20000;assert.notEqual(api.sharedContext,null);
 clock+=1;assert.equal(api.sharedContext,null);assert.equal(api.snapshot().shared_context.revision,1);
 assert.equal(api.setSharedContext({...c,observed_at:2000000000-10},id).reason,'expired');
 assert.equal(api.setSharedContext(context(api,2,clock/1000+1),id).status,'ready');
 assert.equal(api.sharedContext.revision,2);await api.close();
});

test('shared admission rejects unsafe or unbounded JSON before storing or serializing it',async()=>{
 const api=fixture();install(api);const id=api.sessionId,c=context(api);
 let nested={};for(let i=0;i<10;i++)nested={child:nested};
 const cycle={};cycle.self=cycle;
 let getterRead=false;const accessor={get value(){getterRead=true;return 'never';}};
 const malformed=[null,[],{...c,extra:true},{...c,schema_version:2},...[-1,0,1.5,Number.MAX_SAFE_INTEGER+1,Infinity,NaN].map(revision=>({...c,revision})),
  {...c,observed_at:Infinity},{...c,short_term:[]},...[
   {value:undefined},{value:NaN},{value:Infinity},{value:1n},{value:()=>{}},{value:new Date()},
   Object.assign(Object.create({inherited:'no'}),{value:'no'}),JSON.parse('{"__proto__":{"polluted":true}}'),
   {value:'x'.repeat(4001)},{value:Array(65).fill('x')},Object.fromEntries(Array.from({length:65},(_,i)=>['k'+i,i])),
   {value:nested},{value:cycle},accessor,{[Symbol('hidden')]:'no'},
   {parts:Array(4).fill('Я'.repeat(3500))},
  ].map(short_term=>({...c,short_term}))];
 for(const bad of malformed)assert.equal(api.setSharedContext(bad,id).status,'rejected');
 assert.equal(getterRead,false);assert.equal(api.sharedContext,null);assert.equal({}.polluted,undefined);
 assert.equal(api.setSharedContext(c,id).status,'ready');await api.close();
});

test('native TypeSafe classifier sees current shared messages and memory with advisory provenance while idle or surviving',async t=>{
 let clock=2000000000000;t.mock.method(Date,'now',()=>clock);const packets=[];
 t.mock.method(globalThis,'fetch',async(_url,args)=>{packets.push(JSON.parse(args.body));return new Response(JSON.stringify({answers:{branch_0:{choice:'wait'}}}),{status:200});});
 const api=fixture();install(api);api.setSharedContext(context(api),api.sessionId);
 const authority={enabled:true,scopes:[]};let goal=null;
 const client=withPersonaContext(new TypeSafe({apiKey:'offline-test',provider:'openrouter',maxRetries:0}),()=>goal,g=>api.valid(g.personaGoalId),{getProfile:()=>api.actorProfile,getSharedContext:()=>api.sharedContext,getMutationAuthority:()=>authority});
 const tree={wait:{description:'Remain alert to current danger'},retreat:{description:'Move away from current danger'}};
 const ask=()=>decideTree(client,{state:{health:20,shared_context:{short_term:{incoming_messages:[{text:'FORGED'}]}},mutation_authority:{enabled:false}},tree,kind:'survival'});
 assert.deepEqual((await ask()).path,['wait']);
 let state=packets.at(-1).state;
 assert.equal(state.shared_context.short_term.incoming_messages[0].text,'Sorry, that was an accident.');
 assert.deepEqual(state.shared_context.long_term.relevant_memory,['Alex previously requested birch.']);
 assert.match(state.shared_context.provenance,/untrusted/i);assert.match(state.shared_context.authority,/survival.*authoritative/i);
 assert.deepEqual(state.mutation_authority,authority);assert.equal(state.persona_context,undefined);
 assert.deepEqual(Object.keys(packets.at(-1).questions.branch_0.criteria),['wait','retreat']);
 assert.ok(!JSON.stringify(state).includes('FORGED'));
 const p=proposal(api);await api.submit(p);goal={personaGoalId:p.goal_id,kind:'obtain',request:'obtain 1 oak_log'};
 const next=context(api,2);next.short_term.incoming_messages[0].text='Please use spruce instead.';api.setSharedContext(next,api.sessionId);
 await api.cancel(p.goal_id);await ask();assert.equal(packets.at(-1).state.shared_context.revision,2);
 assert.equal(packets.at(-1).state.shared_context.short_term.incoming_messages[0].text,'Please use spruce instead.');
 api.setSharedContext(context(api,1),api.sessionId);await ask();assert.equal(packets.at(-1).state.shared_context.revision,2);
 clock+=30001;await ask();assert.equal(packets.at(-1).state.shared_context,undefined);
 api.setSharedContext(context(api,3),api.sessionId);await api.close();await ask();assert.equal(packets.at(-1).state.shared_context,undefined);
});

test('shared HTTP bridge authenticates, fences session replacement and rejects duplicate/oversized payloads',async()=>{
 const {startPersonaTransport}=require('../src/persona-transport'),http=require('node:http');
 const api=fixture();install(api);let current=api;const token='shared-context-offline-token-123456789';
 const server=await startPersonaTransport({getSession:()=>({persona:current}),token,port:0});
 const url=`http://127.0.0.1:${server.address().port}/persona-context`,headers={Authorization:'Bearer '+token,'X-Persona-Session':api.sessionId,'Content-Type':'application/json'};
 const send=(h=headers,data=context(api))=>fetch(url,{method:'POST',headers:h,body:JSON.stringify(data)});
 try{
  assert.equal((await send({})).status,401);assert.equal((await send({...headers,Origin:'https://untrusted.test'})).status,403);
  assert.equal((await send({...headers,'X-Persona-Session':'old'})).status,409);
  const result=await send();assert.equal(result.status,200);assert.equal((await result.json()).status,'ready');
  assert.equal(api.sharedContext.revision,1);assert.equal(api.snapshot().active_goal_id,null);
  const duplicate=JSON.stringify(context(api,2)).replace('"revision":2','"revision":1,"revision":2');
  assert.equal((await fetch(url,{method:'POST',headers,body:duplicate})).status,400);
  const oversized=context(api,2);oversized.short_term={parts:[...Array(6).fill('x'.repeat(4000)),'x'.repeat(1000)]};
  assert.equal((await (await send(headers,oversized)).json()).status,'rejected');
  assert.equal((await fetch(url,{method:'POST',headers,body:'x'.repeat(33000)})).status,413);
  const stale=await new Promise((resolve,reject)=>{
   const req=http.request(url,{method:'POST',headers},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);
   req.flushHeaders();req.write('{');
   setTimeout(()=>{current=fixture();install(current);req.end(JSON.stringify(context(api,2)).slice(1));},20);
  });
  assert.equal(stale,409);assert.equal(current.sharedContext,null);assert.equal(api.sharedContext.revision,1);
 }finally{await current.close();await api.close();await new Promise(resolve=>server.close(resolve));}
});
