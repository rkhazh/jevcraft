'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {playerIdentities}=require('../src/persona-roster');
const id=n=>`00000000-0000-4000-8000-${n.toString(16).padStart(12,'0')}`;
test('uses current server roster even without nearby entity and never derives UUIDs',()=>{
 const players={Alex:{uuid:id(1).toUpperCase(),username:'Alex'},Other:{username:'Other'},bad:{uuid:'not-uuid',username:'Bad'},nil:{uuid:'00000000-0000-0000-0000-000000000000',username:'Nil'},injected:{uuid:id(2),username:'Alex /op'}};
 assert.deepEqual(playerIdentities({players}),[{uuid:id(1),name:'Alex'}]);delete players.Alex;assert.deepEqual(playerIdentities({players}),[]);assert.deepEqual(playerIdentities({}),[]);
});
test('ambiguous identity conflicts fail closed and duplicate identical entries collapse',()=>{
 assert.deepEqual(playerIdentities({players:{a:{uuid:id(1),username:'Alex'},b:{uuid:id(1),username:'Operator'}}}),[]);
 assert.deepEqual(playerIdentities({players:{a:{uuid:id(1),username:'Alex'},b:{uuid:id(2),username:'alex'}}}),[]);
 assert.deepEqual(playerIdentities({players:{a:{uuid:id(1),username:'Alex'},b:{uuid:id(1),username:'Alex'}}}),[{uuid:id(1),name:'Alex'}]);
});
test('output bounded to128 valid compact identity pairs',()=>{
 const players=Object.fromEntries(Array.from({length:200},(_,i)=>[i,{uuid:id(i+1),username:`P${i}`,entity:{},extra:'secret'}]));
 const rows=playerIdentities({players});assert.equal(rows.length,128);assert.ok(rows.every(r=>Object.keys(r).join(',')==='uuid,name'));assert.ok(Buffer.byteLength(JSON.stringify(rows))<10000);
});
