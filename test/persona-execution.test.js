'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {executionSnapshot}=require('../src/persona-execution');
test('execution separates actual world evidence from placed counter and ages survival evidence',()=>{
 const now=100000,goal={kind:'build',personaGoalId:'g',status:'running',buildId:'b',blueprint:{blocks:[{},{}]},buildOwned:{a:{},b:{}},step:{action:'mine',item:'stone'},survivalAction:{action:'tunnel_from_warden',reason:'threat nearby',at:new Date(now-20000).toISOString()}};
 let checks=0;const bot={_turn:{holder:'survival',phase:'pocket_next',since:now-1000}},active={goal};
 const verify=()=>{checks++;return {verified:false,matched_blocks:0,unknown_blocks:2}};
 const s=executionSnapshot(bot,active,{now,verify});assert.equal(s.goal_id,'g');assert.equal(s.status,'interrupted');assert.equal(s.survival_action.fresh,false);assert.equal(s.interruption.reason,'pocket_next');assert.equal(s.build_progress.placements_recorded,2);assert.equal(s.build_progress.world_verified,false);assert.equal(s.build_progress.matched_blocks,0);
 executionSnapshot(bot,active,{now:now+1000,verify});assert.equal(checks,1);executionSnapshot(bot,active,{now:now+2100,verify});assert.equal(checks,2);
});
