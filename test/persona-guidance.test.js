'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
// Import before toggling persona mode, matching the community entrypoint.
const {withRealTime,question}=require('../src/decisions');
test('external persona tactical guidance follows supplied goal; upstream defaults survive runtime toggles',()=>{
 const old=process.env.JEV_PERSONA_MODE;
 try{
  delete process.env.JEV_PERSONA_MODE;
  for(const id of ['mining_depth','food_enough','encounter_stance']){
   const spec=question(id),before=withRealTime(spec,{dimension:'overworld'}).guidance;
   assert.match(before,/fastest dragon kill/);
   process.env.JEV_PERSONA_MODE='1';
   for(const dimension of ['overworld','the_nether']){const text=withRealTime(spec,{dimension}).guidance;assert.doesNotMatch(text,/fastest dragon kill|death costs only/);assert.match(text,/supplied active persona goal/);assert.match(text,/health/);assert.match(text,/resources/);}
   delete process.env.JEV_PERSONA_MODE;assert.equal(withRealTime(spec,{dimension:'overworld'}).guidance,before);
  }
 }finally{if(old===undefined)delete process.env.JEV_PERSONA_MODE;else process.env.JEV_PERSONA_MODE=old}
});
