'use strict';
const {randomUUID}=require('node:crypto');
function parseSecret(data,protocol,mcHost,expectedUuid){
 if(!Buffer.isBuffer(data)||data.length>2048||![20,21].includes(protocol))throw new Error('Invalid voice packet');
 let offset=0;const take=n=>{if(offset+n>data.length)throw new Error('Truncated voice packet');const b=data.subarray(offset,offset+n);offset+=n;return b};
 const uuid=()=>{const h=take(16).toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`};
 const int=()=>take(4).readInt32BE(),byte=()=>take(1)[0],bool=()=>{const n=byte();if(n>1)throw new Error('Invalid flag');return !!n};
 const secret=take(16).toString('base64'),connection_id=protocol===21?uuid():null;
 let port=int();const bot_uuid=uuid(),codec=byte(),mtu=int(),distance=take(8).readDoubleBE(),keep_alive=int();bool();
 let size=0,shift=0,n;do{if(shift>=35)throw new Error('Invalid host length');n=byte();size+=(n&127)*2**shift;shift+=7;}while(n&128);
 if(size>512)throw new Error('Voice host too long');const encoded=take(size),voiceHost=encoded.toString('utf8');if(!Buffer.from(voiceHost).equals(encoded))throw new Error('Invalid UTF8');bool();
 if(offset!==data.length||bot_uuid!==expectedUuid?.toLowerCase()||codec>2||port<1||port>65535||mtu<128||mtu>65507||keep_alive<100||keep_alive>60000||!Number.isFinite(distance)||distance<0)throw new Error('Invalid voice parameters');
 let host=voiceHost||mcHost;
 if(voiceHost){if(/[\s/@?#\\]/.test(voiceHost))throw new Error('Invalid voice host');const parsed=new URL(`udp://${voiceHost}`);if(parsed.pathname||parsed.username||parsed.password)throw new Error('Invalid voice endpoint');host=parsed.hostname.replace(/^\[|\]$/g,'');if(parsed.port)port=Number(parsed.port);}
 if(!host||port<1||port>65535)throw new Error('Invalid voice endpoint');
 return {bot_uuid,protocol,secret,connection_id,host,port,codec,mtu,keep_alive};
}
function installSvcHandshake(bot,config,{preferred=21,delayMs=2500,now=()=>performance.now()}={}){
 let current=null,generation=randomUUID(),timer=null,active=false,closed=false,lastRequested=-Infinity;const attempted=new Set();
 function reset(){current=null;generation=randomUUID();active=false;attempted.clear();clearTimeout(timer)}
 function request(protocol){if(closed||!active)return;attempted.add(protocol);const payload=Buffer.alloc(4);payload.writeInt32BE(protocol);bot._client.write('custom_payload',{channel:'voicechat:request_secret',data:payload});}
 function receive(packet){if(!active||closed||packet.channel!=='voicechat:secret')return;
  for(const protocol of attempted){try{const parsed=parseSecret(packet.data,protocol,config.host,bot.player?.uuid||bot._client.uuid);current=parsed;clearTimeout(timer);return;}catch{}}
 }
 bot._client.on('custom_payload',receive);bot.on('respawn',reset);bot.once('end',()=>{closed=true;reset();bot._client.removeListener('custom_payload',receive)});
 function start(){if(closed)return;lastRequested=now();reset();active=true;try{
   bot._client.write('custom_payload',{channel:'minecraft:register',data:Buffer.from('voicechat:secret\0voicechat:request_secret')});
   request(preferred);timer=setTimeout(()=>{if(!current){try{request(preferred===20?21:20)}catch{reset()}}},delayMs);timer.unref?.();
  }catch{reset()}}
 return {start,refresh(){if(closed)return 'voice_unavailable';if(now()-lastRequested<10000)return 'rate_limited';start();return active?'pending':'voice_unavailable';},reset,read(session_id){return active&&!closed&&current?{session_id,generation,...current}:null}};
}
module.exports={parseSecret,installSvcHandshake};
