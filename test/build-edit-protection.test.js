'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {BuildRegistry}=require('../src/builds');
function fixture(){
 const registry=new BuildRegistry(null),cell={x:1,y:64,z:2,material:'oak_planks'};
 const canonical={id:'canonical',from:'persona:Tolik',dimension:'overworld',status:'complete',blueprint:{blocks:[cell]},buildOwned:{'1,64,2':15}};
 const abandoned={id:'abandoned',from:'persona:Tolik',dimension:'overworld',status:'unfinished',blueprint:{blocks:[cell,{...cell,x:8}]},buildOwned:{}};
 registry.state.builds=[canonical,abandoned];
 const bot={game:{dimension:'overworld'},blockAt:()=>({name:'oak_planks',stateId:15,getProperties:()=>({})})};
 return {registry,canonical,abandoned,bot};
}
test('current owned canonical wall wins over same-owner unexecuted plan only',()=>{
 const {registry,canonical,bot}=fixture();
 assert.deepEqual([...registry.editProtection(bot,canonical)],['8,64,2']);
 assert.deepEqual([...registry.claimed('overworld','canonical')],['1,64,2','8,64,2']);
});
test('other placed, completed or other-owner structures remain protected',()=>{
 for(const mode of ['placed','complete','other-owner']){
  const {registry,canonical,abandoned,bot}=fixture();
  if(mode==='placed')abandoned.buildOwned['1,64,2']=15;
  if(mode==='complete')abandoned.status='complete';
  if(mode==='other-owner')abandoned.from='persona:Other';
  assert.ok(registry.editProtection(bot,canonical).has('1,64,2'),mode);
 }
});
test('canonical claim needs loaded exact ownership and planned state evidence',()=>{
 for(const mode of ['unknown','changed','unowned','wrong-design']){
  const {registry,canonical,bot}=fixture();
  if(mode==='unknown')bot.blockAt=()=>null;
  if(mode==='changed')bot.blockAt=()=>({name:'oak_planks',stateId:16});
  if(mode==='unowned')canonical.buildOwned={};
  if(mode==='wrong-design')canonical.blueprint.blocks[0].material='stone';
  assert.ok(registry.editProtection(bot,canonical).has('1,64,2'),mode);
 }
});
