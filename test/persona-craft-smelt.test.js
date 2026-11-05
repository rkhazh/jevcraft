'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),Module=require('node:module'),{Vec3}=require('vec3');
const registry=require('minecraft-data')('1.21.11');
// Keep the native smelt handler, inventory/window accounting and supply catch.
// Only physical approach to an already-resolved nearby station is substituted.
const load=Module._load;let work;
try{Module._load=function(name,parent,...rest){const result=load.call(this,name,parent,...rest);if(name==='./workstation-access'&&parent.filename.endsWith('/work.js'))return {...result,approachWorkstation:async(bot,_task,_name,points)=>bot.blockAt(points[0])};return result;};work=require('../src/work');}finally{Module._load=load;}
for(const {pending,lost} of [{pending:false,lost:'fuel'},{pending:true,lost:'fuel'},{pending:false,lost:'input'}])test(`native smelt ${pending?'resumes saved':'starts new'} batch: lost ${lost} cannot spawn obtain work`,async()=>{
 const stock={raw_copper:1,oak_planks:1,furnace:1,crafting_table:1},p=new Vec3(1,64,0);let closes=0,gathers=0,input=pending?{name:'raw_copper',count:1}:null;
 const furnace={inputItem:()=>input,fuelItem:()=>null,outputItem:()=>null,fuel:0,fuelSeconds:0,close(){closes++},putInput:async()=>{input={name:'raw_copper',count:1};stock.raw_copper=0},putFuel:async()=>assert.fail('no fuel remains')};
 const bot={registry,game:{gameMode:'survival',dimension:'overworld'},entity:{position:new Vec3(.5,64,.5)},inventory:{items:()=>Object.entries(stock).filter(([,count])=>count).map(([name,count])=>({name,count,type:registry.itemsByName[name].id}))},blockAt:q=>({name:'furnace',position:q}),findBlocks:()=>[p],openFurnace:async()=>{delete stock[lost==='fuel'?'oak_planks':'raw_copper'];return furnace},_syncWindow:async()=>{},entities:{}};
 const goal={kind:'craft',item:'copper_ingot',count:1,personaCraftPolicy:{source:'carried_inventory'},personaHold:true};
 if(pending)goal.smelting={item:'copper_ingot',from:'raw_copper',fuelItem:'oak_planks',position:{...p},dimension:'overworld',targetInventory:1,count:1,startedAt:Date.now()};
 // Gathering discovery is not a permitted substitute for the lost carried fuel.
 const find=bot.findBlocks;bot.findBlocks=options=>{if(options.maxDistance===32&&options.count===48){gathers++;throw new Error('harvesting fallback reached');}return find(options)};
 await assert.rejects(work.smelt(bot,{check(){}},{action:'smelt',item:'copper_ingot',from:'raw_copper',fuelItem:'oak_planks',count:1},goal,()=>{}),e=>e.personaCraftTerminal===true&&/supplies|fuel|oak_planks|raw_copper/.test(e.message));
 assert.ok(goal.smelting,'actual batch remains recorded');assert.equal(goal.smelting.supplyWork,undefined);assert.deepEqual(goal.smelting.missingSupply,{item:lost==='fuel'?'oak_planks':'raw_copper',count:1});assert.equal(gathers,0);assert.ok(closes>0);
});
test('one-furnace carried fuel budget is not split into optional side furnaces',async()=>{
 const stock={raw_copper:6,coal:1,furnace:2,crafting_table:1},p=new Vec3(1,64,0);let sideReads=0,opened=0;
 const bot={registry,game:{gameMode:'survival',dimension:'overworld'},entity:{position:new Vec3(.5,64,.5)},inventory:{items:()=>Object.entries(stock).map(([name,count])=>({name,count,type:registry.itemsByName[name].id}))},blockAt:q=>{if(q.x<1&&q.x>=0&&q.z<1&&q.z>=0)return {name:'air',position:q,boundingBox:'empty'};if(!q.equals(p)){sideReads++;throw new Error('optional side-furnace preparation reached')}return {name:'furnace',position:p};},findBlocks:()=>[p],openFurnace:async()=>{opened++;throw new Error('main furnace opened')},entities:{}};
 const goal={kind:'craft',item:'copper_ingot',count:6,personaCraftPolicy:{source:'carried_inventory'},personaHold:true};
 const plan=require('../src/persona-craft').plan(bot,goal);assert.equal(plan.at(-1).consumes.coal,1);
 await assert.rejects(work.smelt(bot,{check(){}},plan.at(-1),goal,()=>{}),/main furnace opened/);
 assert.equal(sideReads,0);assert.equal(opened,1);assert.equal(stock.coal,1);assert.equal(goal.smeltingSides,undefined);
});

// Derived from offline-review-smelt-interruption-20261105.js/.json. The same
// station-approach fixture above is used; Task and threat detection stay real.
// Introduce the interruption only after entering the native cooking wait.
for(const interruption of ['threat','cancel'])test(`native cooking wait yields to ${interruption} and retains its batch`,{timeout:3000,concurrency:false},async t=>{
 const {Task}=require('../src/skills'),{checkThreats}=require('../src/danger');
 const p=new Vec3(1,64,0);let closed=0,waiting=false,interrupted=false,timer;
 const furnace={inputItem:()=>({name:'raw_copper',count:1}),fuelItem:()=>({name:'oak_planks',count:1}),outputItem:()=>null,fuel:1,fuelSeconds:10,close(){closed++}};
 const bot={registry,version:'1.21.11',game:{gameMode:'survival',dimension:'overworld'},health:20,food:20,oxygenLevel:20,time:{timeOfDay:1000},
  entity:{id:0,position:new Vec3(.5,64,.5),height:1.8,onGround:true,effects:{},metadata:[]},inventory:{items:()=>[]},entities:{},world:{raycast:()=>null},
  blockAt:q=>q.equals(p)?{name:'furnace',position:p,boundingBox:'block'}:{name:q.y<64?'stone':'air',position:q,boundingBox:q.y<64?'block':'empty',shapes:q.y<64?[[0,0,0,1,1,1]]:[]},
  findBlocks:()=>[p],openFurnace:async()=>furnace,_syncWindow:async()=>{},dig:async()=>assert.fail('no gathering while interrupted')};
 const task=new Task('recipe-interruption','recipe-interruption');
 task.interruptCheck=()=>checkThreats(bot);
 task.opportunityClient={systemOne:async()=>assert.fail('cooking wait must not call a model')};
 const batch={item:'copper_ingot',from:'raw_copper',fuelItem:'oak_planks',position:{...p},dimension:'overworld',targetInventory:1,count:1,startedAt:Date.now()};
 const goal={kind:'craft',item:'copper_ingot',count:1,personaHold:true,personaCraftPolicy:{source:'carried_inventory'},smelting:batch};
 const log=t.mock.method(console,'log',(...args)=>{
  if(!waiting&&String(args[0]).startsWith('[smelt] copper_ingot at')){
   waiting=true;
   timer=setTimeout(()=>{
    interrupted=true;
    if(interruption==='cancel')task.cancel();
    else bot.entities[1]={id:1,name:'creeper',type:'mob',position:new Vec3(2.5,64,.5),velocity:new Vec3(0,0,0),height:1.7,width:.6,isValid:true,metadata:[]};
   },20);
  }
 });
 const deadline=setTimeout(()=>task.cancel(),2000);
 try{
  await assert.rejects(work.smelt(bot,task,batch,goal,()=>{}),{name:interruption==='threat'?'NeedsSafety':'Cancelled'});
  assert.equal(waiting,true,'the native cooking wait was reached');
  assert.equal(interrupted,true,'the requested interruption happened before the fallback deadline');
  assert.equal(closed,1,'the interrupted furnace window was closed');
  assert.strictEqual(goal.smelting,batch,'the real pending batch remains available to resume');
  assert.equal(batch.targetInventory,1);assert.deepEqual(batch.position,{...p});
  assert.equal(batch.supplyWork,undefined);assert.equal(batch.missingSupply,undefined);
 }finally{clearTimeout(timer);clearTimeout(deadline);task.cancel();log.mock.restore();}
});
