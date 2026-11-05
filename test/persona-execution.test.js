'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {executionSnapshot}=require('../src/persona-execution');
test('persona idle controller policy is not an accepted request or an instruction to the planner',()=>{
 const now=100000,request='Stay nearby between admitted persona goals; react to survival needs without optional resource gathering or exploration';
 const idle={idle:true,startedAt:now-1000,goal:{kind:'survive',personaHold:true,request,step:{action:'persona_hold'}}};
 const held=executionSnapshot({_turn:{holder:'work',phase:'persona_hold',since:now-100}},idle,{now});
 assert.equal(held.status,'holding');assert.equal(held.goal_id,null);assert.equal(held.request,null);
 assert.equal(held.current_turn.phase,'persona_hold');
 const threatened=executionSnapshot({_turn:{holder:'survival',phase:'escape',since:now-100}},idle,{now});
 assert.equal(threatened.interruption.active,true);assert.equal(threatened.request,null);
 const working={idle:false,startedAt:now-1000,goal:{...idle.goal,kind:'craft',personaGoalId:'fresh',request:'craft 1 glass'}};
 const interrupted=executionSnapshot({_turn:{holder:'survival',phase:'escape',since:now-100}},working,{now});
 assert.equal(interrupted.request,'craft 1 glass');assert.equal(interrupted.goal_id,'fresh');assert.equal(interrupted.status,'interrupted');
 assert.equal(executionSnapshot({}, {...idle,goal:{...idle.goal,personaHold:false}},{now}).request,request);
});
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

test('native failures stay observable after lastError is cleared and across a task handoff',()=>{
 const now=100000, survival={attempts:{food:{action:'food_search',target:'stock',why:'search brought no food',at:90000,count:3}},stanceFailed:[{choice:'fight',where:{x:1,y:62,z:2},at:99000,why:'target has no reachable swing'}]};
 const goal={kind:'survive',step:{action:'old_work'},survival,lastError:null};
 const active={goal,startedAt:95000},bot={_turn:{holder:'survival',phase:'stance: seal',since:99900}};
 const s=executionSnapshot(bot,active,{now});
 assert.equal(s.step_source,'recorded_goal');
 assert.equal(s.current_turn.phase,'stance: seal');
 assert.equal(s.native_feedback.judgment,'controller_report');
 const [fight]=s.native_feedback.current_attempts,[food]=s.native_feedback.historical_attempts;
 assert.equal(fight.outcome,'blocked');assert.equal(fight.reason,'target has no reachable swing');assert.equal(fight.predates_execution,false);
 assert.equal(food.action,'food_search');assert.equal(food.attempts,3);assert.equal(food.predates_execution,true);
 // It is historical evidence, not a failure attributed to the new persona goal.
 const next=executionSnapshot({}, {goal:{kind:'craft',personaGoalId:'new',survival},startedAt:now},{now:now+1});
 assert.equal(next.native_feedback.current_attempts.length,0);
 assert.equal(next.native_feedback.historical_attempts[0].predates_execution,true);
 assert.equal(next.native_feedback.historical_attempts[0].source,'survival_stance');
 assert.equal(next.native_feedback.historical_attempts[0].goal_id,undefined);
});

test('native decision outcomes preserve their own judgment, bounds, and redaction',()=>{
 const entries=Array.from({length:30},(_,i)=>({q:'resource_source',method:'walk',outcome:i%2?'blocked':'progressed',at:100+i,target:{x:i,y:64,z:0},why:'token=secret',gained:'nearer target'}));
 entries.push({q:'bad',method:'future',at:1000,outcome:'done'});
 const goal={kind:'obtain',tried:{entries}};
 const s=executionSnapshot({}, {goal,startedAt:90},{now:200});
 assert.equal(s.native_feedback.current_attempts.length,12);
 assert.equal(s.native_feedback.current_attempts[0].observed_at,.129);
 assert.equal(s.native_feedback.current_attempts[0].outcome,'blocked');
 assert.equal(s.native_feedback.current_attempts[0].reason,'token=[redacted]');
 assert.equal(s.native_feedback.current_attempts[1].outcome,'progressed');
 assert.equal(s.native_feedback.current_attempts[1].gained,'nearer target');
 entries[29].target.x=999;assert.equal(s.native_feedback.current_attempts[0].target.x,29);
});

test('a historical attempt settled now keeps its historical provenance',()=>{
 const goal={kind:'obtain',tried:{entries:[{q:'resource_source',method:'walk',at:90,settledAt:110,outcome:'blocked'}]}};
 const s=executionSnapshot({}, {goal,startedAt:100},{now:120});
 assert.equal(s.native_feedback.current_attempts.length,0);
 const attempt=s.native_feedback.historical_attempts[0];
 assert.equal(attempt.observed_at,.110);assert.equal(attempt.recorded_at,.090);assert.equal(attempt.started_at,undefined);
 assert.equal(attempt.predates_execution,true);assert.equal(attempt.age_ms,10);
});

test('survival reports retain action details without upgrading them to verified results',()=>{
 const s=executionSnapshot({}, {startedAt:100,goal:{kind:'survive',survivalAction:{action:'charge',target:{x:4,y:65,z:2},item:'stone_sword',at:new Date(180).toISOString()}}},{now:200});
 assert.deepEqual(s.survival_action.target,{x:4,y:65,z:2});assert.equal(s.survival_action.item,'stone_sword');assert.equal(s.survival_action.fresh,true);
 assert.equal(s.survival_action.completed,undefined);
});

test('recorded combat failure remains visible beside a stale recovery step',()=>{
 const recorded=require('./fixtures/tolik-native-feedback-20261104.json');
 const prior=recorded.last_execution,now=1793828532428;
 const goal={kind:prior.kind,step:prior.step,survival:recorded.survival,lastError:null,
  survivalAction:{...prior.survival_action,at:new Date(prior.survival_action.observed_at*1000).toISOString()}};
 const bot={_turn:{holder:prior.current_turn.holder,phase:prior.current_turn.phase,since:now-prior.current_turn.age_ms}};
 const s=executionSnapshot(bot,{goal,startedAt:now-120000,idle:true},{now});
 assert.equal(s.step.action,'return_from_shaft');assert.equal(s.step_source,'recorded_goal');
 assert.equal(s.current_turn.phase,'stance: seal');assert.equal(s.interruption.last_error,null);
 assert.equal(s.native_feedback.current_attempts[0].action,'fight');
 assert.match(s.native_feedback.current_attempts[0].reason,/nothing was struck/);
 assert.equal(s.native_feedback.current_attempts[0].outcome,'blocked');
 assert.ok(s.native_feedback.historical_attempts.some(e=>e.action==='food_search'&&e.predates_execution));
 assert.equal(s.goal_id,null);
});

test('032503 persisted combat reports remain historical at a different actor position',()=>{
 const fixture=require('./fixtures/tolik-historical-feedback-20261105.json');
 const survival={stanceFailed:structuredClone(fixture.stanceFailed)},before=JSON.stringify(survival);
 const goal={kind:'survive',step:{action:'persona_hold'},survival};
 const s=executionSnapshot({entity:{position:fixture.actor_position}},{goal,startedAt:fixture.startedAt,idle:true},{now:fixture.now});
 assert.equal(s.status,'holding');assert.equal(s.interruption.active,false);assert.equal(s.survival_action,null);
 assert.deepEqual(s.native_feedback.current_attempts,[]);assert.equal(s.native_feedback.historical_attempts.length,6);
 assert.equal(s.native_feedback.recent_attempts,undefined);
 for(const report of s.native_feedback.historical_attempts){
  assert.equal(report.predates_execution,true);assert.ok(report.age_ms>20000000);
  assert.equal(report.target,null);assert.deepEqual(report.actor_position,fixture.stanceFailed[0].where);
  assert.notDeepEqual(report.actor_position,fixture.actor_position);assert.equal(report.verified,undefined);
 }
 assert.equal(JSON.stringify(survival),before); // Reporting does not change native avoidance memory.
});

test('attempt clocks reject future or reversed evidence; uncertain execution scope stays historical',()=>{
 const entries=[{method:'valid',at:100,settledAt:150,outcome:'blocked'},
  {method:'future_start',at:201},{method:'future_settlement',at:100,settledAt:201},
  {method:'reverse',at:140,settledAt:130},{method:'invalid_start',at:NaN}];
 const goal={kind:'obtain',tried:{entries}};
 const current=executionSnapshot({}, {goal,startedAt:100},{now:200}).native_feedback;
 assert.equal(current.current_attempts.length,1);assert.deepEqual(current.historical_attempts,[]);
 assert.equal(current.current_attempts[0].action,'valid');assert.equal(current.current_attempts[0].age_ms,50);
 for(const startedAt of [undefined,NaN,201]){
  const uncertain=executionSnapshot({}, {goal,startedAt},{now:200}).native_feedback;
  assert.deepEqual(uncertain.current_attempts,[]);assert.equal(uncertain.historical_attempts.length,1);
  assert.equal(uncertain.historical_attempts[0].predates_execution,null);
 }
});

test('current and historical report partitions share the existing twelve-record bound',()=>{
 const entries=Array.from({length:30},(_,i)=>({method:'walk',at:100+i,outcome:'blocked'}));
 const feedback=executionSnapshot({}, {goal:{kind:'visit',tried:{entries}},startedAt:125},{now:200}).native_feedback;
 assert.equal(feedback.current_attempts.length,5);assert.equal(feedback.historical_attempts.length,7);
 assert.equal(feedback.current_attempts[0].observed_at,.129);assert.equal(feedback.historical_attempts.at(-1).observed_at,.118);
});
