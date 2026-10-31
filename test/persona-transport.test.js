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
