'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {idleBackgroundStep}=require('../src/persona-idle');
test('persona hold still runs survival and never starts loot or optional work',async()=>{
 for(const survivalActs of [true,false]){
  const calls=[];const result=await idleBackgroundStep({hold:true,survive:async()=>{calls.push('survive');return survivalActs},loot:async()=>assert.fail('loot'),work:async()=>assert.fail('work'),stopMotion:()=>calls.push('stop')});
  assert.equal(result,survivalActs?'survival':'hold');assert.deepEqual(calls,survivalActs?['survive']:['survive','stop']);
 }
});
test('normal idle preserves survival then loot then background work priority',async()=>{
 for(const [survivalActs,lootActs,expected] of [[true,false,['survive']],[false,true,['survive','loot']],[false,false,['survive','loot','work']]]){
  const calls=[];await idleBackgroundStep({survive:async()=>{calls.push('survive');return survivalActs},loot:async()=>{calls.push('loot');return lootActs},work:async()=>calls.push('work'),stopMotion:()=>assert.fail('normal stopped')});assert.deepEqual(calls,expected);
 }
});
test('survival cancellation or errors propagate without entering background work',async()=>{
 const error=new Error('cancelled');await assert.rejects(idleBackgroundStep({hold:true,survive:async()=>{throw error},stopMotion:()=>assert.fail('stopped')}),e=>e===error);
});
