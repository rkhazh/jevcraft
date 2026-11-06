'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {validateDecisionView,dependenciesMatch}=require('../src/persona-actions');
const view=()=>({schema_version:1,session_id:'s',world_id:'w',persona_id:'p',generation:1,context_revision:1,observation_id:'o',observed_at:100,dependencies:{},blockers:[],candidates:[{id:'s:wait',kind:'wait',args:{seconds:5},source_ids:[],dependencies:{},expected:'wake',cost:{},expires_at:115}]});
test('contract round trip and strict bounds',()=>{const v=view();assert.deepEqual(validateDecisionView(v),v);for(const x of [{...v,extra:1},{...v,candidates:Array(25).fill(v.candidates[0])},{...v,observed_at:NaN}])assert.throws(()=>validateDecisionView(x));});
test('semantic dependencies preserve exact values but ignore publication',()=>{assert.equal(dependenciesMatch({position:{x:1.23456789},context_revision:1},{position:{x:1.23456789},context_revision:2}),true);assert.equal(dependenciesMatch({position:{x:1.23456789}},{position:{x:1.2345678}}),false);});
