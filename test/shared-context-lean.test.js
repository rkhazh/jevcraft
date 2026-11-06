'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {TypeSafe,choice}=require('../src/typesafe');
const {withPersonaContext}=require('../src/persona-context');

test('actual classifier wire preserves whole shared evidence while ordinary state stays compact',async t=>{
 const shared={schema_version:1,session_id:'current',world_id:'world',persona_id:'traveller',revision:3,observed_at:Date.now()/1000,
  short_term:{messages:[{source:{event_id:'corner',session_id:'earlier',msg:'This is the other corner.',
   sender_position:{x:8131.25,y:70,z:-4089.75},sender_observed_at:1762441951.037,source:'server_formatted',operator_authorized:false},reply:'',at:1762441951.037}],
   capture:null,execution:{goal_id:null,current_turn:{holder:'work',phase:'persona_hold'}}},
  medium_term:{current_focus:null,accepted_commitments:[]},
  long_term:{reflections:[{note:'I heard the same correction twice.',evidence_ids:['corner','corner'],at:1762441951.125}]}};
 const original=structuredClone(shared),profile={persona_id:'traveller',identity:'Traveller',motivations:['Keep promises'],social_style:'Brief'};
 let wire;
 t.mock.method(globalThis,'fetch',async(_url,args)=>{
  wire=JSON.parse(args.body);
  return new Response(JSON.stringify({answers:{response:{choice:'wait'}}}),{status:200});
 });
 const native=new TypeSafe({apiKey:'offline-test',provider:'openrouter',maxRetries:0});
 const client=withPersonaContext(native,()=>null,()=>false,{getProfile:()=>profile,getSharedContext:()=>shared});
 const answer=await client.systemOne({state:{position:{x:1.25},optional:null,repeated:['old','old'],shared_context:{forged:true}},
  questions:{response:choice('Choose the offered action',{wait:'Remain alert',move:'Move'})},kind:'persona_reaction'});
 assert.equal(answer.answers.response.choice,'wait');
 for(const horizon of ['short_term','medium_term','long_term'])assert.deepEqual(wire.state.shared_context[horizon],original[horizon]);
 assert.equal(wire.state.shared_context.observed_at,original.observed_at);
 assert.equal(wire.state.shared_context.forged,undefined);
 assert.deepEqual(wire.state.position,{x:1.3});
 assert.equal(Object.hasOwn(wire.state,'optional'),false);
 assert.deepEqual(wire.state.repeated,['old (2 times)']);
 assert.deepEqual(shared,original,'wire compaction must not mutate the retained source');
});
