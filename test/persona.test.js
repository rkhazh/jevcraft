'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createPersona } = require('../src/persona-admission');
function fixture(options={}) {
 let launches=0, stops=0;
 const body={ connected:true,health:20,dimension:'overworld',items:['oak_log'],players:['Alex'],inventory:{} };
 const persona=createPersona({read:()=>body,items:['oak_log'],players:['Alex'],start:async()=>{launches++},stop:async()=>{stops++},...options});
 const proposal=()=>{const s=persona.snapshot();return {schema_version:1,goal_id:randomUUID(),persona_id:'skipper',session_id:s.session_id,observation_id:s.observation_id,issued_at:Date.now()/1000,expires_at:Date.now()/1000+60,state:'proposed',spec:{kind:'obtain',item:'oak_log',count:8,deliver:false}}};
 return {persona,proposal,body,launches:()=>launches,stops:()=>stops};
}
test('accepts once, conflicts on changed replay, rejection preserves running goal',async()=>{
 const f=fixture();const p=f.proposal();assert.equal((await f.persona.submit(p)).status,'accepted');
 assert.equal((await f.persona.submit(p)).status,'accepted');assert.equal(f.launches(),1);
 assert.equal((await f.persona.submit({...p,spec:{...p.spec,count:9}})).reason,'id_conflict');
 assert.equal((await f.persona.submit({...f.proposal(),spec:{kind:'obtain',item:'bedrock',count:1,deliver:false}})).status,'rejected');assert.equal(f.stops(),0);await f.persona.close();
});
test('rejects wrong session, unknown keys, expiry and dangerous state',async()=>{
 const f=fixture(); for(const change of [{session_id:'old'},{extra:true},{expires_at:0},{spec:{kind:'operator_command'}}]) assert.equal((await f.persona.submit({...f.proposal(),...change})).status,'rejected');
 f.body.health=2;assert.equal((await f.persona.submit(f.proposal())).status,'rejected');assert.equal(f.launches(),0);await f.persona.close();
});
test('cancel fences old launches and cannot cancel a different goal',async()=>{
 const f=fixture();const p=f.proposal();await f.persona.submit(p);assert.equal(f.persona.valid(p.goal_id),true);
 await f.persona.cancel('other');assert.equal(f.stops(),0);await f.persona.cancel(p.goal_id);assert.equal(f.persona.valid(p.goal_id),false);assert.equal(f.stops(),1);await f.persona.close();
});
test('lease expiry stops work locally without planner connection',async()=>{
 const f=fixture();const p=f.proposal();p.expires_at=Date.now()/1000+.04;await f.persona.submit(p);await new Promise(r=>setTimeout(r,100));assert.equal(f.persona.valid(p.goal_id),false);assert.equal(f.persona.events(0).events.at(-1).status,'expired');await f.persona.close();
});
test('completion requires observed item count; follow cannot claim completion',async()=>{
 const f=fixture();let p=f.proposal();await f.persona.submit(p);f.persona.finish(p.goal_id,'complete');assert.equal(f.persona.events(0).events.at(-1).status,'failed');
 p=f.proposal();await f.persona.submit(p);f.body.inventory.oak_log=8;f.persona.finish(p.goal_id,'complete');assert.equal(f.persona.events(0).events.at(-1).verified,true);await f.persona.close();
});
test('expiry during admission await cannot revive or acknowledge late work',async()=>{
 let release;const f=fixture({start:()=>new Promise(r=>{release=r})});
 const p=f.proposal();p.expires_at=Date.now()/1000+.025;
 const pending=f.persona.submit(p);await new Promise(r=>setTimeout(r,50));release();
 assert.equal((await pending).status,'rejected');assert.equal(f.persona.valid(p.goal_id),false);assert.equal(f.stops(),1);await f.persona.close();
});
test('close fences immediately while a start callback is still pending',async()=>{
 let release;const f=fixture({start:()=>new Promise(r=>{release=r})});const p=f.proposal();
 const pending=f.persona.submit(p);await new Promise(r=>setImmediate(r));const closing=f.persona.close();
 assert.equal(f.persona.valid(p.goal_id),false);release();await pending;await closing;
});
test('craft and come are generic typed capabilities with factual completion',async()=>{
 const f=fixture();const craft={...f.proposal(),spec:{kind:'craft',item:'oak_log',count:2,deliver:false}};
 assert.equal((await f.persona.submit(craft)).status,'accepted');f.body.inventory.oak_log=2;f.persona.finish(craft.goal_id,'complete');assert.equal(f.persona.events(0).events.at(-1).verified,true);
 f.body.position={x:0,y:64,z:0};f.body.player_positions={Alex:{x:2,y:64,z:0}};
 const come={...f.proposal(),spec:{kind:'come',target:'Alex'}};assert.equal((await f.persona.submit(come)).status,'accepted');f.persona.finish(come.goal_id,'complete');assert.equal(f.persona.events(0).events.at(-1).verified,true);
 const distant={...f.proposal(),spec:{kind:'come',target:'Alex'}};await f.persona.submit(distant);f.body.player_positions.Alex.x=9;f.persona.finish(distant.goal_id,'complete');assert.equal(f.persona.events(0).events.at(-1).status,'failed');await f.persona.close();
});
test('event pages fit 64KiB in UTF-8 and drain a backlog without dropping events',async()=>{
 const f=fixture();for(let n=0;n<150;n++)f.persona.emit({type:'chat',user:'Alex',msg:'😀\n'.repeat(500)});
 let cursor=0, received=[], pages=0;
 do{
  const packet=f.persona.events(cursor);assert.ok(Buffer.byteLength(JSON.stringify(packet),'utf8')<=65536);
  assert.equal(packet.oldest_sequence,1);assert.ok(packet.events.length>0);assert.equal(packet.cursor,packet.events.at(-1).sequence);
  received.push(...packet.events);cursor=packet.cursor;pages++;
  if(!packet.has_more)break;
  assert.ok(pages<151,'pagination must advance');
 }while(true);
 assert.ok(pages>1);assert.deepEqual(received.map(e=>e.sequence),Array.from({length:150},(_,i)=>i+1));
 assert.deepEqual(f.persona.events(cursor),{events:[],cursor:150,oldest_sequence:1,has_more:false});await f.persona.close();
});
test('event ring reports an explicit gap and preserves paginated ordering',async()=>{
 const f=fixture();for(let n=0;n<1005;n++)f.persona.emit({type:'chat',user:'Alex',msg:'hello'});
 const packet=f.persona.events(0);assert.equal(packet.oldest_sequence,6);assert.equal(packet.events[0].sequence,6);assert.equal(packet.cursor,packet.events.at(-1).sequence);assert.equal(packet.has_more,true);await f.persona.close();
});
test('typed model builds are policy gated and completion includes verified structure identity',async()=>{
 let checked=0;const f=fixture({checkBuild:(s,principal)=>{checked++;return principal==='persona:skipper';},verifyBuild:g=>g?.buildId==='owned'});
 const p={...f.proposal(),spec:{kind:'build',request:'An original small room',mode:'fresh',build_id:null,schematic:{}}};
 assert.equal((await f.persona.submit(p)).status,'accepted');assert.ok(checked>=1);
 f.persona.finish(p.goal_id,'complete',{buildId:'owned'});const event=f.persona.events(0).events.at(-1);assert.equal(event.verified,true);assert.equal(event.build_id,'owned');
 const invalid={...f.proposal(),spec:{...p.spec,extra:'bypass'}};assert.equal((await f.persona.submit(invalid)).status,'rejected');await f.persona.close();
 const disabled=fixture();assert.equal((await disabled.persona.submit({...disabled.proposal(),spec:p.spec})).reason,'unsupported_build');await disabled.persona.close();
});
test('build validation detail stays bounded and reason code unchanged; internal errors stay private',async()=>{
 const f=fixture({checkBuild(){throw Object.assign(new Error('internal hidden'),{validationDetail:'oak_stairs needs half top or bottom\n'+ 'x'.repeat(300)})}});
 const p={...f.proposal(),spec:{kind:'build',request:'Build',mode:'fresh',build_id:null,schematic:{}}};const r=await f.persona.submit(p);assert.equal(r.reason,'invalid_build_geometry');assert.equal(r.detail.length,240);assert.ok(!r.detail.includes('\n'));assert.equal(f.launches(),0);await f.persona.close();
 const internal=fixture({checkBuild(){throw new Error('secret internal message')}});const r2=await internal.persona.submit({...internal.proposal(),spec:p.spec});assert.equal(r2.reason,'invalid_build_geometry');assert.ok(!('detail' in r2));await internal.persona.close();
});
test('operator rendezvous admits only matching come and never fabricates observed player or completion',async()=>{
 let started;const rendezvous={target:'Alex',position:{x:100,y:64,z:200},dimension:'overworld'};
 const f=fixture({rendezvous,start:async spec=>{started=spec}});f.body.players=[];f.body.position={...rendezvous.position};f.body.player_positions={};
 const snapshot=f.persona.snapshot();assert.deepEqual(snapshot.rendezvous,rendezvous);assert.deepEqual(snapshot.players,[]);assert.deepEqual(snapshot.player_positions,{});
 snapshot.rendezvous.position.x=999;
 for(const spec of [{kind:'come',target:'Other'},{kind:'follow',target:'Alex'},{kind:'come',target:'Alex',requesterPosition:{x:1,y:2,z:3}}])assert.equal((await f.persona.submit({...f.proposal(),spec})).status,'rejected');
 const proposal={...f.proposal(),spec:{kind:'come',target:'Alex'}};assert.equal((await f.persona.submit(proposal)).status,'accepted');assert.deepEqual(started.requesterPosition,rendezvous.position);
 f.persona.finish(proposal.goal_id,'complete');let terminal=f.persona.events(0).events.at(-1);assert.equal(terminal.verified,false);assert.equal(terminal.status,'failed');
 const next={...f.proposal(),spec:{kind:'come',target:'Alex'}};await f.persona.submit(next);f.body.player_positions.Alex={...rendezvous.position};f.persona.finish(next.goal_id,'complete');terminal=f.persona.events(0).events.at(-1);assert.equal(terminal.verified,true);await f.persona.close();
});
test('operator rendezvous input has bounded finite coordinates and Java player name',()=>{
 const {validateRendezvous}=require('../src/persona-rendezvous');const good={target:'Alex',position:{x:1,y:64,z:2},dimension:'overworld'};
 assert.equal(validateRendezvous(null),null);
 for(const bad of [{...good,target:'/op'},{...good,dimension:'the_nether'},{...good,position:{x:NaN,y:64,z:2}},{...good,position:{x:1,y:400,z:2}}])assert.throws(()=>validateRendezvous(bad));
});
test('community opt-in permits only currently visible authoritative roster players without operator grants',async()=>{
 const f=fixture({players:[],allowVisiblePlayers:true});f.body.player_identities=[{name:'Alex',uuid:'11111111-1111-4111-8111-111111111111'}];
 for(const kind of ['come','follow'])assert.equal((await f.persona.submit({...f.proposal(),spec:{kind,target:'Alex'}})).status,'accepted');
 f.body.players=[];assert.equal((await f.persona.submit({...f.proposal(),spec:{kind:'come',target:'Alex'}})).status,'rejected');f.body.players=['Alex'];f.body.player_identities=[];assert.equal((await f.persona.submit({...f.proposal(),spec:{kind:'come',target:'Alex'}})).status,'rejected');await f.persona.close();
 const closed=fixture({players:[]});closed.body.player_identities=[{name:'Alex',uuid:'11111111-1111-4111-8111-111111111111'}];assert.equal((await closed.persona.submit({...closed.proposal(),spec:{kind:'come',target:'Alex'}})).status,'rejected');await closed.persona.close();
});
