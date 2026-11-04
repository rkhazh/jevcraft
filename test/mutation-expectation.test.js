'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{Vec3}=require('vec3');
const mutations=require('../src/structure-mutations');
function fixture({protectedCell=false,install=true,finish=false}={}){
 const bot=new EventEmitter(),p=new Vec3(13,72,-5),packets=[];let current={name:'dirt',stateId:10},release,updated=false,stopped=false;
 bot._client=new EventEmitter();bot._client.write=(...args)=>packets.push(args);bot.game={dimension:'overworld'};bot.entity={position:new Vec3(0,64,0)};
 bot.buildRegistry={all:()=>protectedCell?[{blueprint:{blocks:[p]}}]:[]};bot.blockAt=q=>current&&({...current,position:q});
 bot._updateBlockState=()=>{updated=true};bot.stopDigging=()=>{stopped=true};
 bot.dig=async block=>{if(finish)bot._client.write('block_dig',{status:0,location:block.position});await new Promise(r=>{release=r});bot._client.write('block_dig',{status:finish?2:0,location:block.position});if(finish)bot._updateBlockState(block.position,0);};
 if(install)mutations.installStructureMutationGuard(bot);
 const expected={operation:'dig',position:p,name:'dirt',stateId:10};
 return {bot,p,packets,expected,change:value=>{current=value},release:()=>release(),updated:()=>updated,stopped:()=>stopped};
}
test('exact expectation rechecks a changed unregistered cap after aiming before dig start',async()=>{
 for(const replacement of [{name:'stone',stateId:1},{name:'dirt',stateId:11},null]){
  const f=fixture(),pending=mutations.withMutationExpectation(f.bot,f.expected,()=>f.bot.dig(f.bot.blockAt(f.p)));
  f.change(replacement);f.release();await assert.rejects(pending,{name:'StructureMutationRefused'});assert.deepEqual(f.packets,[]);
 }
});
test('exact expectation rechecks dig finish and prevents optimistic air after a changed cap',async()=>{
 const f=fixture({finish:true}),pending=mutations.withMutationExpectation(f.bot,f.expected,()=>f.bot.dig(f.bot.blockAt(f.p)));
 assert.equal(f.packets.length,1);f.change({name:'diamond_block',stateId:42});f.release();
 await assert.rejects(pending,{name:'StructureMutationRefused'});assert.equal(f.packets.length,1);assert.equal(f.updated(),false);assert.equal(f.stopped(),true);
});
test('expectations validate without installed structure protection and grant no registered-cell authority',async()=>{
 const f=fixture({install:false,finish:true}),pending=mutations.withMutationExpectation(f.bot,f.expected,()=>f.bot.dig(f.bot.blockAt(f.p)));
 f.release();await pending;assert.deepEqual(f.packets.map(p=>p[1].status),[0,2]);assert.equal(f.bot._registeredStructureProtection,undefined);
 const protectedFixture=fixture({protectedCell:true});
 await assert.rejects(mutations.withMutationExpectation(protectedFixture.bot,protectedFixture.expected,()=>protectedFixture.bot.dig(protectedFixture.bot.blockAt(protectedFixture.p))),/Registered structure/);
 assert.deepEqual(protectedFixture.packets,[]);
});
test('task cancellation at packet finish and expired detached expectation stop dispatch',async()=>{
 const f=fixture({finish:true});let cancelled=false;
 const pending=mutations.withMutationExpectation(f.bot,{...f.expected,check(){if(cancelled)throw Object.assign(new Error('cancelled'),{name:'Cancelled'});}},()=>f.bot.dig(f.bot.blockAt(f.p)));
 cancelled=true;f.release();await assert.rejects(pending,{name:'Cancelled'});assert.equal(f.packets.length,1);assert.equal(f.updated(),false);
 const expired=fixture();let detached;
 await mutations.withMutationExpectation(expired.bot,expired.expected,async()=>{detached=expired.bot.dig(expired.bot.blockAt(expired.p));});
 expired.release();await assert.rejects(detached,{name:'StructureMutationRefused'});assert.equal(expired.packets.length,0);
});
test('expectation is limited to its captured cell, operation and state, even if caller mutates the descriptor',async()=>{
 const f=fixture(),pending=mutations.withMutationExpectation(f.bot,f.expected,()=>f.bot.dig(f.bot.blockAt(f.p.offset(1,0,0))));
 f.expected.position.x++;f.release();await assert.rejects(pending,{name:'StructureMutationRefused'});assert.equal(f.packets.length,0);
 const g=fixture({install:false});
 await assert.rejects(mutations.withMutationExpectation(g.bot,g.expected,async()=>g.bot._client.write('block_place',{location:g.p,direction:1})),{name:'StructureMutationRefused'});assert.equal(g.packets.length,0);
});
