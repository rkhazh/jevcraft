'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{Vec3}=require('vec3');
const {canMove,moveStep}=require('../src/persona-move');
function fixture(){const original={getNeighbors:()=>[{x:1,y:64,z:1,toBreak:[],toPlace:[]},{x:2,y:64,z:1,toBreak:[{}],toPlace:[]},{x:100,y:64,z:1,toBreak:[],toPlace:[]}],canDig:true,allowParkour:true,scafoldingBlocks:[1]};const bot={game:{dimension:'overworld',gameMode:'survival'},entity:{position:new Vec3(.5,64,.5)},registry:{blocksByName:{}},blockAt:p=>({name:p.y<64?'stone':'air',boundingBox:p.y<64?'block':'empty',shapes:p.y<64?[[0,0,0,1,1,1]]:[]}),clearControlStates(){},pathfinder:{movements:original,setMovements(m){this.movements=m},setGoal(){},goto:async()=>{}}};const goal={kind:'move',target:{x:5.5,y:64,z:.5},personaMovePolicy:{anchor:{x:.5,y:64,z:.5},dimension:'overworld'}};return {bot,goal,original};}
test('local movement requires explicit opt-in, finite nearby loaded supported safe cells',()=>{
 const {bot,goal}=fixture();assert.equal(canMove(bot,goal.target),false);assert.equal(canMove(bot,goal.target,{enabled:true}),true);
 assert.equal(canMove(bot,{x:99,y:64,z:0},{enabled:true}),false);assert.equal(canMove(bot,{x:NaN,y:64,z:0},{enabled:true}),false);
 for(const block of [null,{name:'water',boundingBox:'empty',shapes:[]},{name:'lava',boundingBox:'empty',shapes:[]}]){bot.blockAt=()=>block;assert.equal(canMove(bot,goal.target,{enabled:true}),false);}
});
test('path movement has no dig/place/parkour, filters unsafe nodes, and verifies physical arrival',async()=>{
 const {bot,goal,original}=fixture();bot.pathfinder.goto=async()=>{const m=bot.pathfinder.movements;assert.equal(m.canDig,false);assert.equal(m.allowParkour,false);assert.equal(m.canOpenDoors,false);assert.deepEqual(m.scafoldingBlocks,[]);assert.equal(m.getNeighbors({}).length,1);bot.entity.position=new Vec3(5.5,64,.5)};
 assert.equal(await moveStep(bot,{check(){}},goal,()=>{}),true);assert.equal(bot.pathfinder.movements,original);
});
test('ack without arrival fails; lease cancellation and timeout restore movement settings',async()=>{
 const {bot,goal,original}=fixture();await assert.rejects(moveStep(bot,{check(){}},goal,()=>{}),e=>e.personaMoveTerminal===true);assert.equal(bot.pathfinder.movements,original);
 bot.pathfinder.goto=()=>new Promise(()=>{});let checks=0;await assert.rejects(moveStep(bot,{check(){if(++checks>1)throw Object.assign(new Error('expired'),{name:'Cancelled'})}},goal,()=>{},{checkIntervalMs:1}),e=>e.name==='Cancelled');assert.equal(bot.pathfinder.movements,original);
 await assert.rejects(moveStep(bot,{check(){}},goal,()=>{},{timeoutMs:2}),/timed out/);assert.equal(bot.pathfinder.movements,original);
});
