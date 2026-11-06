'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createPersona}=require('../src/persona-admission'),{createPersonaActions}=require('../src/persona-actions');
test('native choice is advisory until normal leased admission and verification',async()=>{
 let started=0,position={x:0,y:64,z:0};
 const api=createPersona({decisionMode:'continuing',worldId:'w',items:[],players:[],allowLocalMove:true,checkMove:()=>true,
 read:()=>({connected:true,health:20,food:20,dimension:'overworld',position,items:[],players:[],inventory:{}}),start:async()=>{started++},stop:async()=>null});
 api.setProfile({persona_id:'p',identity:'Traveller',motivations:['Help'],social_style:'brief'},api.sessionId);
 api.setSharedContext({schema_version:1,session_id:api.sessionId,world_id:'w',persona_id:'p',revision:1,observed_at:Date.now()/1000,short_term:{},medium_term:{},long_term:{}},api.sessionId);
 const s=api.snapshot(),spec={kind:'move',target:{x:3,y:64,z:0}},candidate={id:'move',kind:'start_goal',args:{spec},source_ids:[],dependencies:{},expected:'approach',cost:{},expires_at:s.observed_at+15};
 const actions=createPersonaActions({client:{},getPersona:()=>api});
 const picked=await actions.choose({schema_version:1,session_id:api.sessionId,world_id:'w',persona_id:'p',generation:1,context_revision:1,observation_id:s.observation_id,observed_at:s.observed_at,dependencies:{},candidates:[candidate],blockers:[]});
 assert.equal(started,0);assert.equal(actions.validateSelected(picked).kind,'start_goal');
 const fresh=api.snapshot(),goal={schema_version:1,goal_id:randomUUID(),persona_id:'p',session_id:api.sessionId,observation_id:fresh.observation_id,issued_at:fresh.observed_at,expires_at:fresh.observed_at+60,state:'proposed',spec};
 assert.equal((await api.submit(goal)).status,'accepted');assert.equal(started,1);assert.equal(api.snapshot().last_result,null);
 position=spec.target;api.finish(goal.goal_id,'complete',spec);assert.equal(api.snapshot().last_result.verified,true);await api.close();
});
