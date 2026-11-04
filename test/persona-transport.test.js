const {test}=require('node:test');
const assert=require('node:assert/strict');
const {startPersonaTransport}=require('../src/persona-transport');
test('HTTP authenticates, bounds payloads, rejects commands and origins',async()=>{
 let chats=[];const server=await startPersonaTransport({port:0,token:'a'.repeat(40),getSession:()=>({persona:{snapshot:()=>({connected:true}),chat:t=>chats.push(t)}})});
 const url=`http://127.0.0.1:${server.address().port}`;
 try{
 assert.equal((await fetch(url+'/snapshot')).status,401);
 const headers={Authorization:'Bearer '+'a'.repeat(40),'Content-Type':'application/json'};
 assert.equal((await fetch(url+'/snapshot',{headers})).status,200);
 assert.equal((await fetch(url+'/snapshot',{headers:{...headers,Origin:'https://evil.test'}})).status,403);
 for(const text of ['/op Alex',' @stop','hello\n/op Alex']) assert.equal((await fetch(url+'/chat',{method:'POST',headers,body:JSON.stringify({text})})).status,400);
 assert.equal((await fetch(url+'/chat',{method:'POST',headers,body:JSON.stringify({text:'Hello, Alex!'})})).status,200);assert.deepEqual(chats,['Hello, Alex!']);
 assert.equal((await fetch(url+'/chat',{method:'POST',headers,body:'x'.repeat(33000)})).status,413);
 }finally{await new Promise(r=>server.close(r));}
});
test('duplicate JSON keys including escaped names are rejected',()=>{
 const {parseStrict}=require('../src/persona-transport');
 assert.throws(()=>parseStrict('{"text":"hello","te\\u0078t":"/op Alex"}'));
 assert.throws(()=>parseStrict('{"spec":{"kind":"follow","kind":"obtain"}}'));
 assert.deepEqual(parseStrict('{"a":[{"x":1},{"x":2}]}'),{a:[{x:1},{x:2}]});
});
test('voice secrets require same authorization and origin protection; stale state is unavailable',async()=>{
 let voice={session_id:'session',generation:'generation',secret:'private-value'},snapshots=0;
 const server=await startPersonaTransport({port:0,token:'b'.repeat(40),getSession:()=>({persona:{snapshot(){snapshots++;return {}}},voiceSession:()=>voice})});
 const url=`http://127.0.0.1:${server.address().port}/voice/session`,headers={Authorization:'Bearer '+'b'.repeat(40)};
 try{const denied=await fetch(url);assert.equal(denied.status,401);assert.ok(!(await denied.text()).includes('private-value'));assert.equal((await fetch(url,{headers:{...headers,Origin:'http://bad'}})).status,403);
 const response=await fetch(url,{headers});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await response.json()).secret,'private-value');assert.equal(snapshots,0);voice=null;assert.equal((await fetch(url,{headers})).status,503);
 }finally{await new Promise(r=>server.close(r))}
});
test('voice refresh requires bearer and exact current session header; returns bounded status only',async()=>{
 let calls=0,status='pending';const server=await startPersonaTransport({port:0,token:'c'.repeat(40),getSession:()=>({persona:{sessionId:'current'},refreshVoice(id){assert.equal(id,'current');calls++;return status;}})});
 const url=`http://127.0.0.1:${server.address().port}/voice/session/refresh`,headers={Authorization:'Bearer '+'c'.repeat(40),'X-Persona-Session':'current'};
 try{assert.equal((await fetch(url,{method:'POST'})).status,401);assert.equal((await fetch(url,{method:'POST',headers:{...headers,'X-Persona-Session':'old'}})).status,409);assert.equal(calls,0);const r=await fetch(url,{method:'POST',headers});assert.equal(r.status,202);assert.deepEqual(await r.json(),{status:'pending'});status='rate_limited';assert.equal((await fetch(url,{method:'POST',headers})).status,429);status='voice_unavailable';assert.equal((await fetch(url,{method:'POST',headers})).status,503);
 }finally{await new Promise(r=>server.close(r))}
});
test('voice state validates exact booleans and fences session/generation before TCP mutation',async()=>{
 let calls=0;const server=await startPersonaTransport({port:0,token:'d'.repeat(40),getSession:()=>({persona:{sessionId:'current'},setVoiceState(id,generation,state){if(generation!=='fresh')return 'stale_generation';calls++;assert.deepEqual(state,{muted:true,disabled:false});return 'updated';}})});
 const url=`http://127.0.0.1:${server.address().port}/voice/state`,headers={Authorization:'Bearer '+'d'.repeat(40),'X-Persona-Session':'current','X-Voice-Generation':'fresh','Content-Type':'application/json'},body=JSON.stringify({muted:true,disabled:false});
 try{assert.equal((await fetch(url,{method:'POST',headers:{...headers,'X-Persona-Session':'old'},body})).status,409);assert.equal((await fetch(url,{method:'POST',headers:{...headers,'X-Voice-Generation':'old'},body})).status,409);assert.equal(calls,0);
 for(const bad of [{muted:1,disabled:false},{muted:false,disabled:false,secret:'reject'}])assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify(bad)})).status,400);assert.equal(calls,0);
 const r=await fetch(url,{method:'POST',headers,body});assert.equal(r.status,200);assert.deepEqual(await r.json(),{status:'updated'});assert.equal(calls,1);
 }finally{await new Promise(r=>server.close(r))}
});
test('vision and look require bearer and current session; no external file or URL input',async()=>{
 let captures=0,looks=0;const session={persona:{sessionId:'s'},captureVision:async()=>{captures++;return {session_id:'s',image_base64:'png'}},lookVision:async()=>{looks++;return {status:'looked'}}};
 const server=await startPersonaTransport({port:0,token:'a'.repeat(40),getSession:()=>session}),url=`http://127.0.0.1:${server.address().port}`,headers={Authorization:'Bearer '+'a'.repeat(40),'X-Persona-Session':'s'};
 try{
  assert.equal((await fetch(url+'/vision')).status,401);assert.equal((await fetch(url+'/vision',{headers:{...headers,'X-Persona-Session':'old'}})).status,409);assert.equal(captures,0);
  assert.equal((await fetch(url+'/vision',{headers})).status,200);assert.equal(captures,1);
  assert.equal((await fetch(url+'/look',{method:'POST',headers,body:JSON.stringify({url:'file:///private'})})).status,400);assert.equal(looks,0);
  assert.equal((await fetch(url+'/look',{method:'POST',headers,body:JSON.stringify({target:{x:1,y:64,z:2}})})).status,200);assert.equal(looks,1);
 }finally{await new Promise(r=>server.close(r))}
});
