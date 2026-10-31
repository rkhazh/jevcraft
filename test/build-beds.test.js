'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Vec3}=require('vec3');
const registry=require('minecraft-data')('26.1');
const {regionProperties,buildFootprint,buildCellComplete,blockOwnership,matchesOwnership,placementGoal}=require('../src/build-blocks');
const {buildPalette,validateSchematic}=require('../src/designer');
const block=(name,properties={})=>({name,boundingBox:'block',stateId:1,getProperties:()=>properties});
function design(facing='east') {
 return {name:'bed',description:'Bed on a floor',size:[4,3,4],palette:['oak_planks','white_bed'],regions:[
  {from:[0,0,0],to:[3,0,3],block:'oak_planks',properties:null},
  {from:[1,1,1],to:[1,1,1],block:'white_bed',properties:{facing,half:null}}
 ],entrance:null,existingOffset:null,site:null};
}
test('bed schemas create both horizontal parts but charge one inventory item',()=>{
 assert.ok(buildPalette(registry).includes('white_bed'));
 for(const [facing,head] of Object.entries({north:[1,1,0],south:[1,1,2],east:[2,1,1],west:[0,1,1]})) {
  const s=validateSchematic(design(facing),registry);
  assert.equal(s.materials.white_bed,1);
  const parts=s.blocks.filter(c=>c.material==='white_bed');
  assert.equal(parts.length,2);assert.deepEqual(parts[0].properties,{facing,part:'foot'});
  assert.deepEqual([parts[1].x,parts[1].y,parts[1].z],head);
  assert.equal(parts[1].properties.part,'head');assert.equal(parts[1].companion,true);
 }
});
test('bed validator rejects blocked, unsupported and out-of-bounds second cells',()=>{
 const blocked=design();blocked.regions.push({from:[2,1,1],to:[2,1,1],block:'oak_planks'});
 assert.throws(()=>validateSchematic(blocked,registry),/bed.*free/i);
 const unsupported=design();unsupported.regions.push({from:[2,0,1],to:[2,0,1],block:'air'});
 assert.throws(()=>validateSchematic(unsupported,registry),/bed.*floor/i);
 const outside=design();outside.regions[1].from=outside.regions[1].to=[3,1,1];
 assert.throws(()=>validateSchematic(outside,registry),/bed.*bounds/i);
 assert.throws(()=>regionProperties('white_bed',{facing:'up',half:null}),/facing/);
 assert.throws(()=>regionProperties('white_bed',{facing:'east',half:'top'}),/half/);
});
test('bed completes only with matching foot and head; occupancy does not lose ownership',()=>{
 const cell={x:0,y:1,z:0,material:'white_bed',properties:{facing:'east',part:'foot'}};
 const parts=buildFootprint(cell);assert.equal(parts.length,2);
 const foot=block('white_bed',cell.properties),head=block('white_bed',{facing:'east',part:'head'});
 const bot={blockAt:p=>p.x===0?foot:head};
 assert.equal(buildCellComplete(bot,cell),true);
 assert.equal(buildCellComplete({blockAt:p=>p.x===0?foot:null},cell),false);
 assert.equal(buildCellComplete({blockAt:()=>block('stone')},cell),false);
 assert.equal(buildCellComplete({blockAt:p=>p.x===0?foot:block('white_bed',{facing:'west',part:'head'})},cell),false);
 const owned=blockOwnership(foot);
 assert.equal(matchesOwnership({...foot,stateId:2,getProperties:()=>({...cell.properties,occupied:true})},owned),true);
 assert.equal(matchesOwnership(block('white_bed',{facing:'west',part:'foot'}),owned),false);
});
test('bed placement clicks supporting floor and faces toward its head',()=>{
 const world={getBlock:()=>({shapes:[[0,0,0,1,1,1]]})};
 const goal=placementGoal({world},new Vec3(0,1,0),{material:'white_bed',properties:{facing:'east',part:'foot'}});
 assert.deepEqual(goal.options.faces,[new Vec3(0,-1,0)]);
 assert.equal(goal.options.facing,3); // west: pathfinder face toward player, opposite look east
});
test('Survival placement refuses blocked bed head before equipping or clicking',async()=>{
 const {place}=require('../src/work');
 const bot={entity:{position:new Vec3(-2,1,0)},oxygenLevel:20,health:20,
  blockAt:p=>p.x===1&&p.y===1&&p.z===0?block('stone'):block('air')};
 await assert.rejects(place(bot,{check(){}},new Vec3(0,1,0),'white_bed',{properties:{facing:'east',part:'foot'}}),/room.*companion/i);
});
test('completion consumers checking companion heads still verify the matching foot',()=>{
 const head={x:1,y:1,z:0,material:'white_bed',companion:true,properties:{facing:'east',part:'head'}};
 const footBlock=block('white_bed',{facing:'east',part:'foot'}),headBlock=block('white_bed',head.properties);
 assert.equal(buildCellComplete({blockAt:p=>p.x===0?footBlock:headBlock},head),true);
 assert.equal(buildCellComplete({blockAt:p=>p.x===0?null:headBlock},head),false);
});
