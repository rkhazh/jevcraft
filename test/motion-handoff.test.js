'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{Vec3}=require('vec3');
const motion=require('../src/motion'),visit=require('../src/persona-visit'),registry=require('minecraft-data')('1.21.11'),Block=require('prismarine-block')('1.21.11');
function scene(){
 const bot=new EventEmitter(),writes=[],cells=new Map();let flat=false;
 Object.assign(bot,{registry,version:'1.21.11',game:{dimension:'overworld',gameMode:'survival'},entity:{position:new Vec3(1.1,64,.5),onGround:true,height:1.8,width:.6,effects:{}},entities:{},health:20,food:20,oxygenLevel:20,inventory:{items:()=>[],slots:[]},controlState:{sneak:true,forward:true,jump:false}});
 bot.setControlState=(key,value)=>{writes.push([key,value]);bot.controlState[key]=value;};bot.clearControlStates=()=>{for(const key of Object.keys(bot.controlState))bot.setControlState(key,false);};
 bot.blockAt=p=>{const q=p.floored(),custom=cells.get(q.toString()),b=custom?Block.fromProperties(registry.blocksByName[custom[0]].id,custom[1],0):Block.fromStateId(registry.blocksByName[q.y<=40||q.y===63&&(flat||q.x===0)?'stone':'air'].defaultState,0);b.position=q;return b;};
 require('mineflayer-pathfinder').pathfinder(bot);
 return {bot,writes,set:(p,name,props)=>cells.set(p.toString(),[name,props]),flat:()=>{flat=true;}};
}
test('handoff covers actual pathfinder reset and awaited old cleanup, preserving only existing endangered sneak',async()=>{
 const f=scene(),original=f.bot.setControlState;assert.ok(motion.fallUnder(f.bot));
 await motion.withControlHandoff(f.bot,async()=>{f.bot.pathfinder.setGoal(null);await new Promise(r=>setTimeout(r,5));f.bot.clearControlStates();});
 assert.equal(f.bot.controlState.sneak,true);assert.equal(f.bot.controlState.forward,false);assert.equal(f.bot.setControlState,original);
 f.bot.setControlState('sneak',false);assert.equal(f.bot.controlState.sneak,false,'no global guard prevents a new deliberate controller');
});
test('ordinary ground releases and handoff restores the setter on error or timeout',async()=>{
 for(const failure of [null,'error','timeout']){const f=scene(),original=f.bot.setControlState;f.flat();
  const run=motion.withControlHandoff(f.bot,async()=>{f.bot.pathfinder.setGoal(null);if(failure==='timeout')await new Promise((_,reject)=>setTimeout(()=>reject(new Error('timeout')),5));else if(failure)throw new Error(failure);});
  if(failure)await assert.rejects(run,new RegExp(failure));else await run;
  assert.equal(f.bot.controlState.sneak,false);assert.equal(f.bot.controlState.forward,false);assert.equal(f.bot.setControlState,original);
 }
 const f=scene();f.bot.controlState.sneak=false;await motion.withControlHandoff(f.bot,async()=>{f.bot.setControlState('sneak',true);f.bot.clearControlStates();});assert.equal(f.bot.controlState.sneak,true,'old controller cleanup established a current protective crouch');
});
test('overlapping handoffs restore the raw setter in either completion order',async()=>{
 for(const order of [[0,1],[1,0]]){const f=scene(),original=f.bot.setControlState,releases=[];
  const jobs=[0,1].map(i=>motion.withControlHandoff(f.bot,()=>new Promise(r=>{releases[i]=r;})));
  releases[order[0]]();await jobs[order[0]];f.bot.clearControlStates();assert.equal(f.bot.controlState.sneak,true);
  releases[order[1]]();await jobs[order[1]];assert.equal(f.bot.setControlState,original);f.bot.setControlState('sneak',false);assert.equal(f.bot.controlState.sneak,false);
 }
});
for(const [name,props,x]of [['stone_slab',{type:'bottom',waterlogged:false},.5],['stone_brick_stairs',{facing:'east',half:'bottom',shape:'straight',waterlogged:false},.19]])test(`floating ${name} contact is safe without inventing a full cube beneath it`,async()=>{
 const f=scene();f.bot.entity.position=new Vec3(2+x,64.5,2.5);f.set(new Vec3(2,64,2),name,props);
 assert.equal(motion.fallUnder(f.bot),null);assert.equal(visit.safeFooting(f.bot),true);
 await motion.withControlHandoff(f.bot,async()=>f.bot.clearControlStates());assert.equal(f.bot.controlState.sneak,false);
});
test('crouch-dependent dangerous landing cannot verify arrival; stale references clear prior arrival facts',()=>{
 const f=scene();assert.equal(visit.safeFooting(f.bot),false);
 const d={id:'project:known',source:'project_recorded_entrance',position:{x:1.1,y:64,z:.5},dimension:'overworld'},goal={destination:d,personaVisitPolicy:{destination:d},visitArrival:{distance:0}};
 assert.equal(visit.verifyVisit(f.bot,goal,{resolve:()=>null}),false);assert.equal(goal.visitArrival,undefined);
});
for(const mode of ['danger','replacement','cancelled','ordinary'])test(`native delayed edge release respects ${mode}`,async()=>{
 const f=scene(),bot=f.bot;bot.entity.position.x=.9;bot.controlState.sneak=false;
 const task={cancelled:false,check(){}},skills=require('../src/skills'),{goals}=require('mineflayer-pathfinder');
 bot.pathfinder.goto=async()=>{throw Object.assign(new Error('No route'),{name:'NoPath'});};
 await assert.rejects(skills.navigate(bot,task,new goals.GoalNear(9,64,0,2),{navigationOnly:true,timeoutMs:100}),/No route/);
 assert.equal(bot.controlState.sneak,true);
 if(mode==='replacement'){bot._walkSeq++;f.flat();}else if(mode==='cancelled'){task.cancelled=true;f.flat();}else if(mode==='ordinary')f.flat();else bot.entity.position.x=1.1;
 await new Promise(r=>setTimeout(r,450));assert.equal(bot.controlState.sneak,mode!=='ordinary');
 // A new walk's own ordinary stop may still release its own temporary crouch.
 f.flat();await assert.rejects(skills.navigate(bot,{check(){}},new goals.GoalNear(9,64,0,2),{navigationOnly:true,timeoutMs:100}),/No route/);
 assert.equal(bot.controlState.sneak,false);
});
