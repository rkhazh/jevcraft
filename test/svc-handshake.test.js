'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {parseSecret,installSvcHandshake}=require('../src/svc-handshake');
const uuid='12345678-1234-4234-8234-123456789abc';
function packet(protocol,host='mc.agicraft.ru:25577'){
 const i=n=>{const b=Buffer.alloc(4);b.writeInt32BE(n);return b},u=Buffer.from(uuid.replaceAll('-',''),'hex'),d=Buffer.alloc(8);d.writeDoubleBE(48);const h=Buffer.from(host);
 return Buffer.concat([Buffer.alloc(16,7),...(protocol===21?[u]:[]),i(25577),u,Buffer.from([0]),i(1024),d,i(1000),Buffer.from([1,h.length]),h,Buffer.from([0])]);
}
test('strict protocol20/21 decode and official voice host port override',()=>{
 for(const protocol of [20,21]){const p=parseSecret(packet(protocol),protocol,'fallback',uuid);assert.equal(p.host,'mc.agicraft.ru');assert.equal(p.port,25577);assert.equal(p.secret,Buffer.alloc(16,7).toString('base64'));assert.equal(p.connection_id,protocol===21?uuid:null);assert.equal(p.keep_alive,1000)}
 assert.equal(parseSecret(packet(20,'[::1]:25578'),20,'fallback',uuid).host,'::1');assert.equal(parseSecret(packet(20,'[::1]:25578'),20,'fallback',uuid).port,25578);assert.equal(parseSecret(packet(20,''),20,'fallback',uuid).host,'fallback');
 for(const bad of [packet(20).subarray(0,12),Buffer.concat([packet(20),Buffer.from([1])]),packet(20,'host/path')])assert.throws(()=>parseSecret(bad,20,'fallback',uuid));assert.throws(()=>parseSecret(packet(20),20,'fallback','different'));assert.throws(()=>parseSecret(packet(20),21,'fallback',uuid));
});
test('handshake bounded fallback; respawn and disconnect clear secrets and reject late packets',async()=>{
 const b=new EventEmitter();b.player={uuid};b._client=new EventEmitter();const writes=[];b._client.write=(name,p)=>writes.push(p);
 const s=installSvcHandshake(b,{host:'mc.agicraft.ru'},{preferred:20,delayMs:5});assert.equal(s.read('session'),null);s.start();await new Promise(r=>setTimeout(r,15));assert.deepEqual(writes.filter(p=>p.channel==='voicechat:request_secret').map(p=>p.data.readInt32BE()),[20,21]);
 b._client.emit('custom_payload',{channel:'voicechat:secret',data:packet(20)});const first=s.read('session');assert.equal(first.session_id,'session');assert.equal(first.protocol,20);
 b.emit('respawn');assert.equal(s.read('session'),null);b._client.emit('custom_payload',{channel:'voicechat:secret',data:packet(20)});assert.equal(s.read('session'),null);
 s.start();b._client.emit('custom_payload',{channel:'voicechat:secret',data:packet(20)});assert.notEqual(s.read('session').generation,first.generation);b.emit('end');assert.equal(s.read('session'),null);s.start();assert.equal(s.read('session'),null);
});
test('refresh clears credentials, rate limits requests and cannot revive closed connection',()=>{
 let clock=0;const b=new EventEmitter();b.player={uuid};b._client=new EventEmitter();const writes=[];b._client.write=(n,p)=>writes.push(p);
 const s=installSvcHandshake(b,{host:'mc.agicraft.ru'},{preferred:20,now:()=>clock});s.start();b._client.emit('custom_payload',{channel:'voicechat:secret',data:packet(20)});const old=s.read('s');assert.ok(old);assert.equal(s.refresh(),'rate_limited');assert.equal(writes.length,2);
 clock=10000;assert.equal(s.refresh(),'pending');assert.equal(s.read('s'),null);assert.equal(writes.length,4);assert.equal(s.refresh(),'rate_limited');b._client.emit('custom_payload',{channel:'voicechat:secret',data:packet(20)});assert.notEqual(s.read('s').generation,old.generation);b.emit('end');clock=20000;assert.equal(s.refresh(),'voice_unavailable');assert.equal(writes.length,4);
});
