'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {communityProfile}=require('../src/community-profile');
test('default Skipper profile unchanged; Tolik identity and build policy isolated',()=>{
 const skipper=communityProfile(),tolik=communityProfile('TolikScheben');assert.equal(skipper.username,'SkipperJev');assert.equal(skipper.port,8769);assert.equal(skipper.build,false);assert.equal(tolik.username,'TolikScheben');assert.equal(tolik.port,8770);assert.equal(tolik.build,true);assert.notEqual(tolik.worldId,skipper.worldId);assert.throws(()=>communityProfile('invented'));
});
test('Tolik body state persists across runs without sharing Skipper state or evidence',()=>{
 const {communityStateDirectory}=require('../src/community-profile');
 const one=communityStateDirectory('TolikScheben','/workspace/setup/jevcraft-community/runs/tolik/one','/workspace');
 const two=communityStateDirectory('TolikScheben','/workspace/setup/jevcraft-community/runs/tolik/two','/workspace');
 assert.equal(one,'/workspace/setup/jevcraft-community/characters/TolikScheben/body-state');assert.equal(one,two);
 assert.equal(communityStateDirectory('Skipper','/runs/one','/workspace'),'/runs/one/state');assert.equal(communityStateDirectory('Skipper','/runs/two','/workspace'),'/runs/two/state');assert.throws(()=>communityStateDirectory('../other','/runs','/workspace'));
});
