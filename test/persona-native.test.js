'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {createPersona}=require('../src/persona-admission');
function setup(nativeCapabilities=true){
 const state={connected:true,health:3,dimension:'the_nether',items:['diamond'],players:['Alex'],inventory:{}};
 const starts=[];
 const api=createPersona({nativeCapabilities,read:()=>state,start:async s=>starts.push(s),stop:async()=>starts.at(-1)});
 const propose=spec=>{const s=api.snapshot();return {schema_version:1,goal_id:randomUUID(),persona_id:'tolik',session_id:s.session_id,observation_id:s.observation_id,issued_at:s.observed_at,expires_at:null,state:'proposed',spec};};
 return {api,state,starts,propose};
}
test('native goals have session lifetime across dimensions and expose the full registry',async()=>{
 const f=setup();assert.deepEqual(f.api.snapshot().items,['diamond']);
 const p=f.propose({kind:'native',request:'Find a fortress and return with blaze rods',requester:'Alex'});
 assert.equal((await f.api.submit(p)).status,'accepted');assert.equal(f.api.valid(p.goal_id),true);
 assert.equal(f.starts[0].request,p.spec.request);assert.equal(f.starts[0].nativeCapabilities,true);
 await f.api.cancel(p.goal_id);assert.equal(f.api.valid(p.goal_id),false);
 await f.api.close();
});
test('native crafting accepts full registry and quantities above one stack without carried-input policy',async()=>{
 const f=setup();const p=f.propose({kind:'craft',item:'diamond',count:128,deliver:false});
 assert.equal((await f.api.submit(p)).status,'accepted');assert.equal(f.starts[0].personaCraftPolicy,undefined);
 await f.api.close();
});
test('native work completion is reported as engine completion, never fabricated world verification',async()=>{
 const f=setup();const p=f.propose({kind:'native',request:'Find a fortress',requester:null});
 await f.api.submit(p);f.api.finish(p.goal_id,'complete',{...f.starts[0],kind:'find',status:'complete'});
 const result=f.api.snapshot().last_result;
 assert.equal(result.status,'complete_unverified');assert.equal(result.execution.kind,'find');assert.equal(result.verified,false);
 await f.api.close();
});
test('native opt-in does not weaken session fencing or enable requests in restricted mode',async()=>{
 const f=setup();let p=f.propose({kind:'native',request:'Explore',requester:null});
 assert.equal((await f.api.submit({...p,session_id:'other'})).reason,'wrong_session');
 assert.equal((await f.api.submit({...p,spec:{...p.spec,code:'process.exit()'}})).status,'rejected');
 f.state.connected=false;assert.equal((await f.api.submit(p)).status,'rejected');await f.api.close();
 const restricted=setup(false);p=restricted.propose({kind:'native',request:'Explore',requester:null});
 assert.equal((await restricted.api.submit(p)).status,'rejected');await restricted.api.close();
});
