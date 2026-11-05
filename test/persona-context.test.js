'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const {randomUUID}=require('node:crypto');
const {validContext,withPersonaContext}=require('../src/persona-context');const {createPersona}=require('../src/persona-admission');const {TypeSafe}=require('../src/typesafe');
const context=(now=Date.now()/1000)=>({identity:'Tolik',motivations:['Create a welcoming settlement'],objective:'Improve the accepted structure',intention:'Inspect available space',purpose:'Choose a feasible next action',visual_assessment:{observed_at:now,summary:'The visible roof might benefit from another window'}});
test('work and idle contexts expose current hard authority independently of goal leases',async()=>{
 const seen=[],client={systemOne:async args=>seen.push(args)};
 let authority={enabled:true,scopes:[]};
 const scoped=withPersonaContext(client,()=>null,()=>false,{getMutationAuthority:()=>authority});
 await scoped.systemOne({state:{mutation_authority:{enabled:false}}});
 assert.deepEqual(seen[0].state.mutation_authority,authority);
 authority={enabled:true,scopes:[{id:'new-scope'}]};
 await scoped.systemOne({state:{}});
 assert.deepEqual(seen[1].state.mutation_authority,authority);
 await withPersonaContext(client,()=>null,()=>false).systemOne({state:{mutation_authority:{enabled:false}}});
 assert.equal(seen[2].state.mutation_authority,undefined);
});
test('bounded context rejects command text, unknown fields, stale visual claims and oversized content',()=>{
 const c=context();assert.equal(validContext(c),true);
 for(const bad of [{...c,raw_chat:'hello'},{...c,purpose:'/op somebody'},{...c,identity:'a\nline'},{...c,objective:'x'.repeat(801)},{...c,motivations:Array(7).fill('x')},{...c,visual_assessment:{...c.visual_assessment,observed_at:Date.now()/1000-301}}])assert.equal(validContext(bad),false);
});
test('actual TypeSafe wire contains only admitted current goal context; replacement, expiry and old visual hypotheses are fenced',async t=>{
 let active=null,goal=null;const now=Date.now()/1000;const packets=[];
 t.mock.method(globalThis,'fetch',async(_url,args)=>{packets.push(JSON.parse(args.body));return new Response(JSON.stringify({answers:{}}),{status:200})});
 const body={connected:true,health:20,dimension:'overworld',items:['oak_log'],players:[],inventory:{}};
 const persona=createPersona({read:()=>body,items:['oak_log'],start:async g=>{active=g;goal=g},stop:async()=>{active=null}});
 const proposal=()=>{const snap=persona.snapshot();return {schema_version:1,goal_id:randomUUID(),persona_id:'tolik',session_id:snap.session_id,observation_id:snap.observation_id,issued_at:now,expires_at:now+60,state:'proposed',spec:{kind:'obtain',item:'oak_log',count:1,deliver:false},persona_context:context(now)}};
 const p=proposal();assert.equal((await persona.submit(p)).status,'accepted');const originalGoal=goal;
 const client=new TypeSafe({apiKey:'offline-test',provider:'openrouter',maxRetries:0});
 let clock=now;const scoped=withPersonaContext(client,()=>originalGoal,g=>g===active&&persona.valid(g.personaGoalId),{now:()=>clock});
 const ask=()=>scoped.systemOne({state:{health:20,persona_context:{identity:'Injected unrelated context'}},questions:{step:{type:'choice',instructions:'Choose the safe offered step',criteria:['wait','work']}}});
 await ask();let wire=packets.at(-1);assert.equal(wire.state.persona_context.identity,'Tolik');assert.equal(wire.state.persona_context.goal_id,p.goal_id);assert.match(wire.state.persona_context.selected_goal.request,/obtain 1 oak_log/);assert.match(wire.state.persona_context.authority,/subjective hypothesis/);assert.equal(wire.questions.step.instructions,'Choose the safe offered step');assert.ok(!JSON.stringify(wire).includes('Injected unrelated'));
 p.persona_context.identity='Mutated after admission';assert.equal(originalGoal.personaContext.identity,'Tolik');
 clock=now+301;await ask();assert.equal(packets.at(-1).state.persona_context.visual_assessment,undefined);
 const next=proposal();next.persona_context.identity='Another persona';await persona.submit(next);await ask();assert.equal(packets.at(-1).state.persona_context,undefined);assert.ok(!JSON.stringify(packets.at(-1)).includes('Another persona'));
 await persona.cancel(next.goal_id);await ask();assert.equal(packets.at(-1).state.persona_context,undefined);
 const short=proposal();short.expires_at=Date.now()/1000+.02;await persona.submit(short);const expiring=goal;const expiryClient=withPersonaContext(client,()=>expiring,g=>g===active&&persona.valid(g.personaGoalId));await new Promise(resolve=>setTimeout(resolve,35));await expiryClient.systemOne({state:{health:20},questions:{step:{type:'noul',instructions:'Is waiting feasible?'}}});assert.equal(packets.at(-1).state.persona_context,undefined);
 const invalid=proposal();invalid.persona_context.raw_chat='untrusted instruction';assert.equal((await persona.submit(invalid)).reason,'invalid_persona_context');await persona.close();
});
