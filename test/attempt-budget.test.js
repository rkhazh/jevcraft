'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {TypeSafe}=require('../src/typesafe'),{AttemptBudget}=require('../src/attempt-budget');
test('actual retry dispatches consume shared cap and stop before third fetch',async()=>{
 const old=global.fetch;let calls=0,exhausted=0;global.fetch=async()=>{calls++;return new Response('retry',{status:503})};
 try {const budget=new AttemptBudget(2,{onExhausted:()=>exhausted++});const c=new TypeSafe({provider:'openrouter',apiKey:'fake',maxRetries:4,attemptBudget:budget});await assert.rejects(c.exchange({state:{},questions:{}}),{name:'AttemptBudgetExceeded'});assert.equal(calls,2);assert.equal(budget.used,2);assert.equal(exhausted,1);} finally{global.fetch=old}
});
test('concurrent clients share cap and failed audit prevents fetch',async()=>{
 const old=global.fetch;let calls=0;global.fetch=async()=>{calls++;return new Response('{"answers":{}}')};
 try {const budget=new AttemptBudget(1);const args={provider:'openrouter',apiKey:'fake',maxRetries:0,attemptBudget:budget};const r=await Promise.allSettled([new TypeSafe(args).exchange({state:{},questions:{}}),new TypeSafe(args).exchange({state:{},questions:{}})]);assert.equal(calls,1);assert.equal(r.filter(x=>x.status==='rejected').length,1);
 const broken=new AttemptBudget(1,{record:()=>{throw Object.assign(new Error('audit failed'),{terminal:true})}});await assert.rejects(new TypeSafe({...args,attemptBudget:broken}).exchange({state:{},questions:{}}));assert.equal(calls,1);
 }finally{global.fetch=old}
});
