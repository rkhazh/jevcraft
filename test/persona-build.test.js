'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {prepareBuild,verifyBuild,assertBuildPolicy,describeBuilds}=require('../src/persona-build');
const registry=require('minecraft-data')('1.21.4');
const schematic=()=>({name:'A model design',description:'A floor',size:[3,2,3],palette:['oak_planks'],regions:[{from:[0,0,0],to:[2,0,2],block:'oak_planks',properties:null}],entrance:null,existingOffset:null,site:null});
function fixture(){const entries=[];return {entries,bot:{registry,entity:{position:{x:0,y:65,z:0}},game:{dimension:'overworld'},buildRegistry:{find:id=>entries.find(e=>e.id===id),all:()=>entries},blockAt:()=>({name:'oak_planks'})}};}
test('model-authored geometry is validated in Survival without a template or designer call',()=>{
 const {bot}=fixture();const goal=prepareBuild(bot,{kind:'build',request:'Make a floor',mode:'fresh',build_id:null,schematic:schematic()},'persona:p',{enabled:true});
 assert.equal(goal.design.source.name,'A model design');assert.equal(goal.design.blocks.length,9);assert.equal(goal.design.backend,'persona-validated');
 assert.throws(()=>prepareBuild(bot,{mode:'fresh',schematic:{...schematic(),size:[25,2,3]}},'persona:p',{enabled:true}));
 assert.throws(()=>prepareBuild(bot,{mode:'fresh',schematic:schematic()},'persona:p',{enabled:false}));
});
test('continuation requires owned world structure and an edit schematic aligned to it',()=>{
 const {bot,entries}=fixture();entries.push({id:'b',from:'persona:p',dimension:'overworld',origin:{x:0,y:65,z:0},blueprint:{blocks:[],bounds:{min:{x:0,y:65,z:0},max:{x:2,y:66,z:2}}},design:{source:schematic()}});
 assert.equal(prepareBuild(bot,{mode:'finish',build_id:'b',schematic:null},'persona:p',{enabled:true}).continueBuild.id,'b');
 assert.throws(()=>prepareBuild(bot,{mode:'finish',build_id:'b',schematic:null},'persona:q',{enabled:true}));
 assert.throws(()=>prepareBuild(bot,{mode:'edit',build_id:'b',schematic:schematic()},'persona:p',{enabled:true}));
 const edited=prepareBuild(bot,{mode:'edit',build_id:'b',schematic:{...schematic(),existingOffset:[0,0,0]}},'persona:p',{enabled:true});assert.equal(edited.buildContinuation.mode,'edit');
});
test('completion verifies every block and empty cell; policy refuses oversized terrain before mutations',()=>{
 const {bot}=fixture();const goal={personaBuildPolicy:{anchor:{x:0,y:65,z:0}},blueprint:{blocks:[{x:0,y:65,z:0,material:'oak_planks'}],empty:[{x:0,y:66,z:0}]}};
 bot.blockAt=p=>({name:p.y===65?'oak_planks':'air'});assert.equal(verifyBuild(bot,goal),true);
 bot.blockAt=()=>({name:'air'});assert.equal(verifyBuild(bot,goal),false);
 goal.blueprint.terrain={clear:Array.from({length:2049},()=>({x:0,y:0,z:0})),fill:[]};assert.throws(()=>assertBuildPolicy(goal));
 assert.deepEqual(describeBuilds(bot),[]);
});
test('edits refuse external replacement and continuation retains recorded ownership',()=>{
 const {bot,entries}=fixture();const blueprint={origin:{x:0,y:65,z:0},bounds:{min:{x:0,y:65,z:0},max:{x:2,y:66,z:2}},blocks:[{x:0,y:65,z:0,material:'oak_planks'}],empty:[]};
 entries.push({id:'b',from:'persona:p',dimension:'overworld',origin:blueprint.origin,blueprint,design:{source:schematic()},buildOwned:{'0,65,0':42}});
 bot.blockAt=()=>({name:'diamond_block',stateId:99});
 assert.throws(()=>prepareBuild(bot,{mode:'edit',build_id:'b',schematic:{...schematic(),existingOffset:[0,0,0]}},'persona:p',{enabled:true}));
 const continuing=prepareBuild(bot,{mode:'repair',build_id:'b',schematic:null},'persona:p',{enabled:true});assert.equal(continuing.buildOwned['0,65,0'],42);
});
test('registry persists ownership signatures for later leases',()=>{
 const {BuildRegistry}=require('../src/builds');const registry=new BuildRegistry(null);
 const goal={kind:'build',from:'persona:p',request:'A floor',design:{source:schematic()},buildOwned:{'0,65,0':42},blueprint:{origin:{x:0,y:65,z:0},bounds:{min:{x:0,y:65,z:0},max:{x:2,y:66,z:2}},blocks:[]}};
 const entry=registry.remember(goal,{dimension:'overworld'});assert.equal(entry.buildOwned['0,65,0'],42);goal.buildOwned['0,65,0']=99;assert.equal(entry.buildOwned['0,65,0'],42);
});
