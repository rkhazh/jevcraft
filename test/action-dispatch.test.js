'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Vec3}=require('vec3');
const {decideAction}=require('../src/work');
const {define}=require('../src/decisions');
let serial=0;
function fixture(area='work',options={}){
 const id=`dispatch_contract_${serial++}`;
 define({id,area,kind:'action',primitive:'choice',stakes:'low',tree:true,parent:null,
  question:'Execute this observed action?',trigger:'Offline dispatcher regression',source:'test/action-dispatch.test.js',
  options:[{key:'act',label:options.wait?'a wait: await the next observation':'act',when:options.wait?'a wait: awaiting observation':'the test action is available',...options}]});
 const items=[],bot={entity:{position:new Vec3(.5,64,.5),onGround:true},game:{dimension:'overworld',gameMode:'creative'},time:{timeOfDay:1000},health:20,food:20,oxygenLevel:20,entities:{},
  inventory:{items:()=>items,slots:[]},blockAt:()=>null,_stalls:{marked:0},registry:{itemsByName:{},blocksByName:{}}};
 const goal={kind:'obtain',item:'stone',count:8,status:'running',survival:{}},task={check(){}};
 return {bot,goal,items,id,run:action=>decideAction(bot,task,goal,()=>{},null,()=>{}, {act:{description:'One offline action',...action}}, {},id)};
}

for(const area of ['travel','resources','home'])test(`${area}: explicit false is not converted into action success`,async()=>{
 const f=fixture(area);let calls=0;
 const result=await f.run({run:async()=>{calls++;return false;}});
 assert.equal(calls,1);assert.equal(result,false);assert.equal(f.goal.status,'running');
});

test('partial construction progress returning false stays incomplete and is measured by the existing ledger',async()=>{
 const f=fixture('home');
 const result=await f.run({run:async()=>{f.bot._stalls.marked++;return false;}});
 assert.equal(result,false);assert.equal(f.goal.status,'running');
 assert.equal(f.goal.tried.entries.at(-1).outcome,'progressed');
});

test('void acquisition callbacks remain valid and do not complete the retained goal',async()=>{
 const f=fixture('resources');
 assert.equal(await f.run({run:async()=>{f.items.push({name:'bread',count:1});}}),true);
 assert.equal(f.goal.status,'running');assert.equal(f.goal.tried.entries.at(-1).outcome,'progressed');
});

test('a declared wait can yield without a world delta and is not invented failure',async()=>{
 const f=fixture('work',{wait:true});
 assert.equal(await f.run({waits:require('../src/waits').event('next observation',{toMs:1000}),run:async()=>{}}),true);
 assert.notEqual(f.goal.tried.entries.at(-1).outcome,'blocked');assert.equal(f.goal.status,'running');
});

test('an incomplete void callback remains pending instead of being declared complete or failed',async()=>{
 const f=fixture('travel');
 assert.equal(await f.run({run:async()=>{f.goal.nextLeg={x:10,y:64,z:0};}}),true);
 assert.equal(f.goal.tried.entries.at(-1).outcome,'pending');assert.equal(f.goal.status,'running');
});

test('an interrupted handler preserves its exception instead of being reported as success',async()=>{
 const f=fixture('travel'),error=Object.assign(new Error('Air interrupted the walk'),{name:'NeedsAir'});
 await assert.rejects(f.run({run:async()=>{throw error;}}),e=>e===error);
 assert.equal(f.goal.tried.entries.at(-1).outcome,'pending');assert.equal(f.goal.status,'running');
});
