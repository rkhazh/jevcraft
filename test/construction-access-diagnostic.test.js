'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{Vec3}=require('vec3');
const {constructionAccessDiagnostic}=require('../src/construction-access');
test('access diagnostics distinguish unknown neighbors, noPath and timeout without mutations',()=>{
 let reads=0;const bot={blockAt:p=>{reads++;return p.y===65?null:{name:'stone',shapes:[[0,0,0,1,1,1]]};}};
 const attempts=Array.from({length:16},(_,x)=>({candidate:{position:new Vec3(x,64,0),operation:'dig'},direct:false,routeStatus:x%2?'timeout':'noPath'}));
 const d=constructionAccessDiagnostic(bot,{personaGoalId:'g',buildId:'b'},attempts);
 assert.equal(d.candidate_count,16);assert.equal(d.candidates.length,4);assert.equal(reads,24);assert.equal(d.candidates[0].route_status,'noPath');assert.equal(d.candidates[1].route_status,'timeout');assert.equal(d.candidates[0].direct_reachable,false);
 assert.deepEqual(d.candidates[0].neighbors[0],{position:{x:0,y:65,z:0},loaded:false,material:null,full_cube:false});assert.equal(d.candidates[0].neighbors[1].full_cube,true);
 const empty=constructionAccessDiagnostic(bot,{},[]);assert.equal(empty.candidate_count,0);assert.deepEqual(empty.candidates,[]);
});
