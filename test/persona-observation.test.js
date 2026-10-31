'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {nearbyWorld}=require('../src/persona-observation');
test('nearby world uses three local block reads and reports closest twelve entities',()=>{
 const reads=[],self={id:1,position:{x:.7,y:64.2,z:.4}};
 const entities={self};for(let i=0;i<20;i++)entities[i]={id:i+2,name:'cow',type:'mob',position:{x:i+1,y:64.2,z:.4},health:i===0?7:undefined};
 entities.far={name:'zombie',position:{x:100,y:64,z:0}};
 const state=nearbyWorld({entity:self,entities,blockAt:p=>{reads.push(p);return {name:p.y===63?'stone':'air',biome:{name:'plains'}}}});
 assert.equal(reads.length,3);assert.equal(state.ground_block,'stone');assert.equal(state.feet_block,'air');assert.equal(state.head_block,'air');assert.equal(state.biome,'plains');
 assert.equal(state.nearby_entities.length,12);assert.equal(state.nearby_entities[0].health,7);assert.equal(state.nearby_entities[0].name,'cow');assert.ok(state.nearby_entities.every(e=>e.distance<=24));assert.ok(!('health' in state.nearby_entities[1]));
});
test('missing or unloaded world state produces unknown values without throwing',()=>{
 const empty={biome:null,ground_block:null,feet_block:null,head_block:null,nearby_entities:[]};
 assert.deepEqual(nearbyWorld({}),empty);
 assert.deepEqual(nearbyWorld({entity:{position:{x:0,y:1,z:0}},entities:{bad:{position:{x:NaN,y:0,z:0}}},blockAt(){throw new Error('chunks unavailable')}}),empty);
 assert.deepEqual(nearbyWorld({entity:{position:{x:NaN,y:1,z:0}}}),empty);
});
test('biome IDs resolve through registry and entity labels remain bounded',()=>{
 const state=nearbyWorld({entity:{position:{x:0,y:2,z:0}},registry:{biomes:{4:{name:'forest'}}},blockAt:()=>({name:'air',biome:4}),entities:{player:{username:'x'.repeat(200),type:'player',position:{x:1,y:2,z:0}}}});
 assert.equal(state.biome,'forest');assert.equal(state.nearby_entities[0].name.length,64);
});
