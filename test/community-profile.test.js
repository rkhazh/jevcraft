'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {communityProfile}=require('../src/community-profile');
test('default Skipper profile unchanged; Tolik identity and build policy isolated',()=>{
 const skipper=communityProfile(),tolik=communityProfile('TolikScheben');assert.equal(skipper.username,'SkipperJev');assert.equal(skipper.port,8769);assert.equal(skipper.build,false);assert.equal(tolik.username,'TolikScheben');assert.equal(tolik.port,8770);assert.equal(tolik.build,true);assert.notEqual(tolik.worldId,skipper.worldId);assert.throws(()=>communityProfile('invented'));
});
