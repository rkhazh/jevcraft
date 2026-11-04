'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {BuildRegistry}=require('../src/builds'),{describeBuilds}=require('../src/persona-build');
function fixture(){
 const goal={kind:'build',from:'persona:builder',personaId:'builder',personaGoalId:'source-goal',personaSessionId:'source-session',request:'A model-chosen structure',blueprint:{origin:{x:20,y:65,z:-18},bounds:{min:{x:20,y:65,z:-18},max:{x:20,y:65,z:-18}},blocks:[{x:20,y:65,z:-18,material:'oak_planks'}],empty:[]},design:{source:{name:'structure'}},buildOwned:{}};
 return {goal,registry:new BuildRegistry(null)};
}
test('registered project exposes original trusted persona envelope and keeps it across later leases',()=>{
 const {goal,registry}=fixture(),entry=registry.remember(goal,{dimension:'overworld'});
 const expected={goal_id:'source-goal',session_id:'source-session',persona_id:'builder'};
 assert.deepEqual(entry.persona_source,expected);
 goal.personaGoalId='next-goal';goal.personaSessionId='next-session';registry.remember(goal,{dimension:'overworld'});
 assert.deepEqual(registry.find(entry.id).persona_source,expected);
 const bot={buildRegistry:registry,game:{dimension:'overworld'},entity:{position:{x:20,y:66,z:-18}},blockAt:()=>({name:'oak_planks'})};
 assert.deepEqual(describeBuilds(bot)[0].persona_source,expected);
});
test('historical projects and untrusted or incomplete identities do not acquire creator provenance',()=>{
 for(const change of [{personaSessionId:undefined},{personaId:'someone-else'},{personaGoalId:''}]){
  const {goal,registry}=fixture();Object.assign(goal,change);assert.equal(registry.remember(goal,{dimension:'overworld'}).persona_source,undefined);
 }
 const {goal,registry}=fixture();delete goal.personaSessionId;registry.remember(goal,{dimension:'overworld'});goal.personaSessionId='later-session';
 assert.equal(registry.remember(goal,{dimension:'overworld'}).persona_source,undefined);
});
