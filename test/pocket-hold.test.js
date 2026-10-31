'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {withinSealHold}=require('../src/pocket-hold');
test('a seal choice must be reassessed after three minutes even if a hidden threat remains',()=>{
 const plan={choice:'stay',at:100000,until:190000};
 assert.equal(withinSealHold(plan,279999),true);
 assert.equal(withinSealHold(plan,280000),false);
 assert.equal(withinSealHold(plan,340000),false);
});
test('missing or invalid decision timestamps cannot hold a stay indefinitely',()=>{
 for(const plan of [null,{}, {at:NaN},{at:Infinity},{at:500000}])assert.equal(withinSealHold(plan,300000),false);
});
