'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {TypeSafe}=require('../src/typesafe'),{AttemptBudget}=require('../src/attempt-budget');
const {attachHttpUsageLedger,usageRow}=require('../src/http-usage-ledger');
test('allowlist preserves zero cost and treats missing/nonfinite charges as unknown',()=>{const r=usageRow({attempt:1,usage:{cost:0,prompt_tokens:10,completion_tokens:0,secret:'private'},state:'private',body:'private'});assert.equal(r.cost_usd,0);assert.equal(r.charge_known,true);assert.equal(r.output_tokens,0);assert.ok(!JSON.stringify(r).includes('private'));assert.equal(usageRow({usage:{cost:Infinity}}).charge_known,false)});
test('retry responses and failures recorded separately without doubling logical ledger',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'http-usage-')),file=path.join(dir,'usage.jsonl'),old=global.fetch;let calls=0,logical=0;
 global.fetch=async()=>++calls===1?new Response('{"secret":"private"}',{status:503}):new Response('{"answers":{},"usage":{"cost":0.002,"input_tokens":42}}');
 try{const c=new TypeSafe({provider:'openrouter',apiKey:'private',attemptBudget:new AttemptBudget(3)});c.ledger=attachHttpUsageLedger({record(){logical++}},file);await c.systemOne({state:'private',questions:{}});assert.equal(logical,1);let rows=fs.readFileSync(file,'utf8').trim().split('\n').map(JSON.parse);assert.equal(rows.length,2);assert.equal(rows[0].status,503);assert.equal(rows[0].charge_known,false);assert.equal(rows[1].cost_usd,.002);assert.equal(rows[1].input_tokens,42);assert.ok(!fs.readFileSync(file,'utf8').includes('private'));
 global.fetch=async()=>{throw new Error('private')};c.maxRetries=0;await assert.rejects(c.systemOne({state:'private',questions:{}}));rows=fs.readFileSync(file,'utf8').trim().split('\n').map(JSON.parse);assert.equal(rows.length,3);assert.equal(rows[2].status,null);assert.equal(rows[2].charge_known,false);
 }finally{global.fetch=old;fs.rmSync(dir,{recursive:true,force:true})}
});
test('bounded ledger invokes failure handler instead of growing indefinitely',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'usage-bound-'));let errors=0;try{const f=path.join(dir,'u');const l=attachHttpUsageLedger({record(){}},f,{maxEntries:1,onError:()=>errors++});l.recordAttempt({attempt:1});l.recordAttempt({attempt:2});assert.equal(errors,1);assert.equal(fs.readFileSync(f,'utf8').trim().split('\n').length,1)}finally{fs.rmSync(dir,{recursive:true,force:true})}});
