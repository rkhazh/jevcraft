'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Vec3}=require('vec3'),{Survival}=require('../src/survival');
const {withActionScope}=require('../src/action-scope');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const botOf=()=>({game:{dimension:'overworld'},entity:{position:new Vec3(1.5,64,2.5)},health:9,food:19,inventory:{items:()=>[{name:'bread',count:2}]}});

test('native reports reach the observer before a subsequent action overwrites them',()=>{
 const bot=botOf(),seen=[],goal={survival:{}};
 const observe=require('../src/body-reports').observer(report=>seen.push(structuredClone(report)));
 observe(goal);
 const survival=Object.assign(Object.create(Survival.prototype),{bot,state:goal.survival});
 survival.report(goal,()=>{}, {action:'observed_arrival',position:{x:1.5,y:64,z:2.5},supported:true,surface:true});
 survival.report(goal,()=>{}, {action:'food_trip',distance:12});
 assert.deepEqual(seen.map(r=>r.action),['observed_arrival','food_trip']);
 assert.equal(seen[0].surface,true);assert.equal(goal.survivalAction.action,'food_trip');
});

test('direct native report assignments are observed without replaying restored history',()=>{
 const reports=require('../src/body-reports'),seen=[],goal={survivalAction:{action:'historical'}};
 const observe=reports.observer(r=>seen.push(structuredClone(r)));
 observe(goal);observe(goal);assert.equal(seen.length,0);
 // Native domains also assign this existing field directly, outside Survival.report.
 goal.survivalAction={action:'food_trip',distance:12};
 goal.survivalAction={action:'food_collected',count:1};
 assert.deepEqual(seen.map(r=>r.action),['food_trip','food_collected']);
 assert.deepEqual(JSON.parse(JSON.stringify(goal)),{survivalAction:{action:'food_collected',count:1}});
 const restored=JSON.parse(JSON.stringify(goal));observe(restored);assert.equal(seen.length,2);
 restored.survivalAction={action:'another_method'};assert.equal(seen.length,3);
});

test('relaying a child report cannot reattribute it to the parent save callback',async()=>{
 const reports=require('../src/body-reports'),bot=botOf(),state={},parent={personaGoalId:'g'},child={},sessionId=randomUUID();
 bot._observeActionReports=reports.observer(report=>reports.record(bot,state,report,{source:'controller_report',sessionId,worldId:'w'}));
 await withActionScope(bot,'work',parent,async()=>{
  await withActionScope(bot,'survival',child,async()=>{child.survivalAction={action:'native_method',count:1};});
  // work.saveWork relays this very object after the child's controller returns.
  parent.survivalAction=child.survivalAction;
 });
 assert.equal(state.bodyReports.length,1);assert.equal(state.bodyReports[0].controller,'survival');
 assert.equal(state.bodyReports[0].goal_id,null);assert.equal(state.bodyReports[0].interrupted_goal_id,'g');
 await withActionScope(bot,'work',parent,async()=>{parent.survivalAction.count=2;parent.survivalAction=parent.survivalAction;});
 assert.equal(state.bodyReports.length,2);assert.equal(state.bodyReports[1].report.count,2);
 const historical={action:'past_method'},restored={survivalAction:historical};bot._observeActionReports(restored);
 await withActionScope(bot,'work',parent,async()=>{parent.survivalAction=historical;});
 assert.equal(state.bodyReports.length,2);
});

test('scope outcomes retain actual controller even after an interruption',async()=>{
 const bot=botOf(),outcomes=[];bot._onActionOutcome=e=>outcomes.push(e);
 await withActionScope(bot,'work',{personaGoalId:'intent'},async()=>{
  await assert.rejects(withActionScope(bot,'survival',null,async()=>{throw Object.assign(new Error('threat changed'),{name:'NeedsSafety'});}));
 });
 assert.equal(outcomes[0].controller,'survival');assert.equal(outcomes[0].goal_id,null);
 assert.equal(outcomes[0].interrupted_goal_id,'intent');assert.equal(outcomes[0].outcome,'interrupted');
 assert.equal(outcomes[1].controller,'work');assert.equal(outcomes[1].outcome,'yielded');
});

test('reports survive save/reload with fixed identities and do not certify a persona goal',async()=>{
 const reports=require('../src/body-reports'),{GoalStore}=require('../src/objectives');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jev-body-reports-')),file=path.join(dir,'world.json');
 try{
  const bot=botOf(),state={version:1},sessionId=randomUUID(),store=new GoalStore(file);
  const save=()=>{store.save(state);store.flushSync();};
  await withActionScope(bot,'survival',null,async()=>{
   reports.record(bot,state,{action:'observed_arrival',supported:true,surface:true},{source:'controller_report',sessionId,worldId:'w',now:1000});save();
   reports.record(bot,state,{action:'food_trip',distance:12},{source:'controller_report',sessionId,worldId:'w',now:1100});save();
  });
  const loaded=new GoalStore(file).read(),tail=reports.tail(loaded,'w');
  assert.equal(tail.length,2);assert.equal(tail[0].report.surface,true);
  assert.equal(tail[0].goal_id,null);assert.equal(tail[0].verified,undefined);
  assert.equal(tail[0].source_session_id,sessionId);assert.equal(tail[0].observed_at,1);
  assert.deepEqual(tail,reports.tail(state,'w'));
  tail[0].report.surface=false;assert.equal(reports.tail(loaded,'w')[0].report.surface,true);
  assert.deepEqual(reports.tail(loaded,'another-world'),[]);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('physical scope snapshots retain food and health changes while unchanged yields coalesce',()=>{
 const reports=require('../src/body-reports'),bot=botOf(),state={},options={source:'scope_end',sessionId:randomUUID(),worldId:'w',now:1000};
 const report={action:'vitals',outcome:'yielded'};
 assert.ok(reports.record(bot,state,report,options));
 assert.equal(reports.record(bot,state,report,{...options,now:1100}),null);
 bot.food=20;bot.inventory.items=()=>[{name:'bread',count:1}];
 assert.ok(reports.record(bot,state,report,{...options,now:1200}));
 assert.equal(reports.tail(state,'w')[0].observed.inventory.bread,2);
 assert.equal(reports.tail(state,'w')[1].observed.inventory.bread,1);
});

test('journal and snapshot tails are bounded, omit secrets, and retain primitive world evidence',()=>{
 const reports=require('../src/body-reports'),bot=botOf(),state={},options={source:'controller_report',sessionId:randomUUID(),worldId:'w'};
 for(let n=0;n<90;n++)reports.record(bot,state,{action:'inspect',count:n,token:'private',reason:'Bearer secret',surface:true,nested:{not:'a point'}},{...options,now:n+1});
 assert.equal(state.bodyReports.length,64);
 const tail=reports.tail(state,'w');assert.ok(tail.length<=16);assert.ok(Buffer.byteLength(JSON.stringify(tail))<=12288);
 assert.equal(tail.at(-1).report.count,89);assert.equal(tail.at(-1).report.token,undefined);
 assert.equal(tail.at(-1).report.reason,'Bearer [redacted]');assert.equal(tail.at(-1).report.nested,undefined);
});

test('routine physical observations cannot evict every significant controller report',()=>{
 const reports=require('../src/body-reports'),bot=botOf(),state={},options={sessionId:randomUUID(),worldId:'w'};
 reports.record(bot,state,{action:'observed_arrival',surface:true},{...options,source:'controller_report',now:1000});
 for(let n=0;n<100;n++){
  bot.health=9+n/100;
  reports.record(bot,state,{action:'vitals',outcome:'yielded'},{...options,source:'scope_end',now:1100+n});
 }
 assert.equal(state.bodyReports.length,64);
 assert.ok(reports.tail(state,'w').some(r=>r.report.action==='observed_arrival'));
});

test('repeated controller statements with only observed vitals changes do not become new events',()=>{
 const reports=require('../src/body-reports'),bot=botOf(),state={},options={sessionId:randomUUID(),worldId:'w',source:'controller_report'};
 const statement=()=>({action:'some_method',health:bot.health,food:bot.food,target:{x:1,y:64,z:2}});
 assert.ok(reports.record(bot,state,statement(),{...options,now:1000}));
 bot.health=10;
 assert.equal(reports.record(bot,state,statement(),{...options,now:1100}),null);
 assert.ok(reports.record(bot,state,{action:'survival',outcome:'yielded'},{...options,source:'scope_end',now:1200}));
 bot.health=11;
 assert.equal(reports.record(bot,state,statement(),{...options,now:1300}),null);
 assert.ok(reports.record(bot,state,{...statement(),target:{x:2,y:64,z:2}},{...options,now:1400}));
 assert.ok(reports.record(bot,state,{action:'survival',outcome:'interrupted',reason:'new hazard'},{...options,source:'scope_end',now:1500}));
 assert.ok(reports.record(bot,state,{...statement(),target:{x:2,y:64,z:2}},{...options,now:1600}));
});
