'use strict';
const fs=require('node:fs');
const numeric=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
// Deliberate allowlist: never retain provider bodies, IDs, prompts or error messages.
function usageRow(entry){
 const usage=entry.usage||{},cost=numeric(usage.cost);
 return {at:new Date().toISOString(),attempt:Number.isSafeInteger(entry.attempt)?entry.attempt:null,status:Number.isInteger(entry.status)?entry.status:null,
  ok:entry.ok===true,aborted:entry.aborted===true,latency_ms:numeric(entry.latencyMs),
  input_tokens:numeric(usage.input_tokens??usage.prompt_tokens),output_tokens:numeric(usage.output_tokens??usage.completion_tokens),
  cost_usd:cost,charge_known:cost!==null};
}
function attachHttpUsageLedger(ledger,file,{maxEntries=60,onError=()=>{}}={}){
 let written=0;
 // Preserve logical-call accounting; recordAttempt receives each actual dispatch result.
 return {record:entry=>ledger.record(entry),recordAttempt(entry){
  try{if(written>=maxEntries)throw new Error('HTTP usage ledger bound exceeded');
   fs.appendFileSync(file,JSON.stringify(usageRow(entry))+'\n',{mode:0o600});written++;
  }catch{onError();}
 }};
}
module.exports={attachHttpUsageLedger,usageRow};
