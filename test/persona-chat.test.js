'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {exclusivePersonaSpeech,installPersonaChat}=require('../src/persona-chat');
function fixture(community=true){const b=new EventEmitter();b._client=new EventEmitter();b.username='TolikScheben';b.players={SkipperBot:{username:'SkipperBot',uuid:'11111111-1111-4111-8111-111111111111'}};const events=[];installPersonaChat(b,{community,emit:e=>events.push(e)});return {b,events};}
test('actual community formatted chat reaches conversation with roster identity but no operator authority',()=>{
 const {b,events}=fixture();b.emit('messagestr','<SkipperBot> TolikScheben, здорово, земеля!','system',{},null);
 assert.equal(events.length,1);assert.equal(events[0].user,'SkipperBot');assert.equal(events[0].source,'server_formatted');assert.equal(events[0].operator_authorized,false);
 b.emit('messagestr','<Unknown> hi','system',{},null);b.emit('messagestr','server: <SkipperBot> hi','system',{},null);b.emit('messagestr','<SkipperBot> hi','chat',{},null);assert.equal(events.length,1);
 b.emit('end');assert.equal(b._client.listenerCount('playerChat'),0);
});
test('raw and formatted duplicate once; ordinary same-path repeated messages still arrive',()=>{
 const {b,events}=fixture();const packet={sender:b.players.SkipperBot.uuid,plainMessage:'стой'};
 b._client.emit('playerChat',packet);b.emit('messagestr','<SkipperBot> стой','system',{},null);assert.equal(events.length,1);assert.equal(events[0].operator_authorized,true);
 b._client.emit('playerChat',packet);assert.equal(events.length,2);
 const other=fixture(false);other.b.emit('messagestr','<SkipperBot> hi','system',{},null);assert.equal(other.events.length,0);
});
test('only private persona speech remains public and still obeys slash guard',()=>{
 const b={players:{},sent:[],chat(text){this.sent.push(text)}};
 require('../src/commands').createCommandAccess(b,{users:[]});const speak=exclusivePersonaSpeech(b);
 b.chat('English tactical status');assert.deepEqual(b.sent,[]);speak('Привет, земляк!');assert.deepEqual(b.sent,['Привет, земляк!']);assert.throws(()=>speak('/op somebody'),/fresh explicit/);
});
test('chat binds sender position at receipt, not later bot or sender drift',()=>{
 const {b,events}=fixture();b.game={dimension:'overworld'};b.players.SkipperBot.entity={position:{x:12,y:64,z:34}};
 b.emit('messagestr','<SkipperBot> строй здесь','system',{},null);b.players.SkipperBot.entity.position.x=900;
 assert.deepEqual(events[0].sender_position,{x:12,y:64,z:34});assert.equal(events[0].sender_dimension,'overworld');assert.ok(Number.isFinite(events[0].sender_observed_at));
 delete b.players.SkipperBot.entity;b.emit('messagestr','<SkipperBot> другое','system',{},null);assert.equal(events[1].sender_position,null);assert.equal(events[1].sender_dimension,null);
});
