'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {waitForCommunityChunks}=require('../src/community-chunks');
function setup(){let clock=0;const bot={entity:{position:{x:0,y:400,z:0}},isAlive:true,game:{gameMode:'survival'},world:{getColumnAt:()=>null}};return {bot,options:{now:()=>clock,sleep:async()=>{clock+=100},timeoutMs:1000}}}
test('follows final backend center and requires all25 columns stable200ms',async()=>{
 const {bot,options}=setup();let ticks=0;const reports=[];options.report=e=>reports.push(e);options.sleep=async()=>{ticks++;if(ticks===2){bot.entity.position={x:128,y:64,z:128};bot.world.getColumnAt=p=>p.x>=96&&p.x<=160&&p.z>=96&&p.z<=160?{}:null}};options.now=()=>ticks*100;
 await waitForCommunityChunks(bot,options);assert.equal(ticks,4);assert.equal(reports.length,2);assert.deepEqual(reports.at(-1).center,{x:128,z:128});
});
test('unloaded columns and nonSurvival remain failure within bound',async()=>{const a=setup();await assert.rejects(waitForCommunityChunks(a.bot,a.options),/not stably loaded/);const b=setup();b.bot.world.getColumnAt=()=>({});b.bot.game.gameMode='adventure';await assert.rejects(waitForCommunityChunks(b.bot,b.options),/not stably loaded/)});
test('read errors and disconnect never become readiness',async()=>{const a=setup();a.bot.world.getColumnAt=()=>{throw new Error('chunk decode failed')};await assert.rejects(waitForCommunityChunks(a.bot,a.options),/decode/);const b=setup();await assert.rejects(waitForCommunityChunks(b.bot,{...b.options,ended:()=>true}),/Connection ended/)});
