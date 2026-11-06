'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {validateEdit,verifyEdit,executeEdit}=require('../src/persona-edit');
function f(){const cells=new Map([['1,64,0',{name:'stone',stateId:1,getProperties:()=>({}),boundingBox:'block'}]]);const bot={entity:{position:{x:0,y:64,z:0}},game:{dimension:'overworld'},blockAt:p=>cells.get(`${p.x},${p.y},${p.z}`)||null,registry:{blocksByName:{stone:{boundingBox:'block'},air:{}}}};const spec={kind:'edit',dimension:'overworld',cells:[{position:{x:1,y:64,z:0},expected:{name:'stone',state_id:1,properties:{}},desired:{name:'air',properties:{}}}],preserve:[],source_task_id:null};return {bot,spec,cells};}
test('65 changed cells rejected',()=>{const x=f();x.spec.cells=Array(65).fill(x.spec.cells[0]);assert.throws(()=>validateEdit(x.spec,{dimension:'overworld',position:x.bot.entity.position}));});
test('unloaded and partial edits never verify',()=>{const x=f(),g={...x.spec};assert.equal(verifyEdit(x.bot,g).verified,false);x.cells.clear();assert.equal(verifyEdit(x.bot,g).verified,false);x.cells.set('1,64,0',{name:'air',stateId:0,getProperties:()=>({})});assert.equal(verifyEdit(x.bot,g).verified,true);});
test('human replacement blocks mutation before tool use',async()=>{const x=f();x.cells.get('1,64,0').stateId=2;const g={...x.spec};await assert.rejects(executeEdit(x.bot,g,{task:{check(){}},save(){},authorize:()=>true}),/changed/);});
test('authority revoked and protected cells refuse edits',async()=>{const x=f();await assert.rejects(executeEdit(x.bot,{...x.spec},{task:{check(){}},save(){},authorize:()=>false}),/authority/);x.bot._registeredStructureProtection=()=>true;await assert.rejects(executeEdit(x.bot,{...x.spec},{task:{check(){}},save(){},authorize:()=>true}),/registered/);});
test('real native mutation guards permit one granted dig and verify its observed result',async()=>{
 const {EventEmitter}=require('node:events'),{Vec3}=require('vec3'),authority=require('../src/mutation-authority'),mutations=require('../src/structure-mutations');
 const bot=new EventEmitter(),p=new Vec3(1,64,0),blocks=new Map(),packets=[];
 bot.username='actor';bot.entity={position:new Vec3(0,64,0)};bot.game={dimension:'overworld'};bot._client=new EventEmitter();bot._client.write=(...a)=>packets.push(a);
 bot.inventory={items:()=>[],slots:[]};bot.registry={blocksByName:{stone:{boundingBox:'block',states:[]}}};bot.buildRegistry={all:()=>[]};
 bot.blockAt=q=>({name:blocks.has(q.toString())?'stone':'air',stateId:blocks.has(q.toString())?1:0,boundingBox:blocks.has(q.toString())?'block':'empty',position:q,getProperties:()=>({}),shapes:[]});blocks.set(p.toString(),true);
 bot.dig=async b=>{bot._client.write('block_dig',{status:0,location:b.position});bot._client.write('block_dig',{status:2,location:b.position});blocks.delete(b.position.toString());bot.emit('blockUpdate',b,bot.blockAt(p));};
 const policy=authority.validateMutationAuthority({version:1,world_id:'w',principal:'actor',temporary_empty_placement:false,grants:[{id:'g',dimension:'overworld',operations:['dig'],source:'operator fixture',cells:[{x:1,y:64,z:0}]}]},{worldId:'w',principal:'actor'});
 authority.installMutationAuthority(bot,{policy,worldId:'w',principal:'actor',world:{known:{},store:{save(){}}}});mutations.installStructureMutationGuard(bot,{validGoal:()=>true});
 const goal=f().spec;assert.equal(await executeEdit(bot,goal,{task:{check(){}},save(){}}),true);assert.deepEqual(packets.map(p=>p[1].status),[0,2]);assert.equal(goal.editVerification.verified,true);
});
