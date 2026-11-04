'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {executionSnapshot}=require('../src/persona-execution');
test('execution separates actual world evidence from placed counter and ages survival evidence',()=>{
 const now=100000,goal={kind:'build',personaGoalId:'g',status:'running',buildId:'b',blueprint:{blocks:[{},{}]},buildOwned:{a:{},b:{}},step:{action:'mine',item:'stone'},survivalAction:{action:'tunnel_from_warden',reason:'threat nearby',at:new Date(now-20000).toISOString()}};
 let checks=0;const bot={_turn:{holder:'survival',phase:'pocket_next',since:now-1000}},active={goal,startedAt:now-30000};
 const verify=()=>{checks++;return {verified:false,matched_blocks:0,unknown_blocks:2}};
 const s=executionSnapshot(bot,active,{now,verify});assert.equal(s.goal_id,'g');assert.equal(s.status,'interrupted');assert.equal(s.survival_action.fresh,false);assert.equal(s.interruption.reason,'pocket_next');assert.equal(s.build_progress.placements_recorded,2);assert.equal(s.build_progress.world_verified,false);assert.equal(s.build_progress.matched_blocks,0);
 executionSnapshot(bot,active,{now:now+1000,verify});assert.equal(checks,1);executionSnapshot(bot,active,{now:now+2100,verify});assert.equal(checks,2);
});

test('prior-goal, expired and future turn timestamps never claim a current interruption',()=>{
 const now=100000,goal={kind:'come',status:'running',personaGoalId:'new',survivalAction:{action:'escape',at:new Date(now+1000).toISOString()}},active={goal,startedAt:now-2000};
 for(const since of [now-3000,now+1000,NaN]){
  const s=executionSnapshot({_turn:{holder:'survival',phase:'old escape',since}},active,{now});assert.equal(s.interruption.active,false);assert.equal(s.status,'running');assert.equal(s.survival_action.fresh,false);assert.equal(s.survival_action.age_ms,null);
 }
 const expired=executionSnapshot({_turn:{holder:'vitals',phase:'old food',since:now-9000}},{goal,startedAt:now-20000},{now});assert.equal(expired.current_turn.fresh,false);assert.equal(expired.interruption.active,false);
});
test('mining execution retains actual block drops count and target coordinates',()=>{
 const step={action:'mine',block:'red_sand',drops:'red_sand',count:7,sources:['red_sand'],target:{x:10,y:62,z:-20}};
 const snapshot=executionSnapshot({}, {startedAt:100,goal:{kind:'build',step}},{now:200});
 assert.equal(snapshot.step.block,'red_sand');assert.equal(snapshot.step.drops,'red_sand');assert.equal(snapshot.step.count,7);assert.equal(snapshot.step.item,null);assert.deepEqual(snapshot.step.target,step.target);assert.deepEqual(snapshot.step.position,step.target);
 step.target.x=999;assert.equal(snapshot.step.position.x,10);
});
test('construction and smelting expose bounded explicit details without implying completion',()=>{
 const {normalizeStep}=require('../src/persona-execution');
 assert.deepEqual(normalizeStep({action:'build_schematic',operation:'dig',material:'cobblestone',remainingBlocks:100,position:{x:1,y:62,z:2}}).remainingBlocks,100);
 const step=normalizeStep({action:'smelt',item:'glass',count:7,from:'sand',fuelItem:'coal'});assert.equal(step.from,'sand');assert.equal(step.item,'glass');assert.equal(step.count,7);assert.equal(step.fuel,'coal');assert.equal(step.operation,null);
});
