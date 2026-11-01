'use strict';
const http=require('node:http');
const {timingSafeEqual}=require('node:crypto');
const {exact}=require('./persona-admission');
function plainSpeech(text){return typeof text==='string'&&text.trim().length>0&&text.length<=240&&!/^[\s]*[/@!]/u.test(text)&&!/[\p{Cc}\p{Cf}§]/u.test(text);}
function parseStrict(text) {
 const value=JSON.parse(text), stack=[];
 const tokens=/"(?:\\.|[^"\\])*"|[{}\[\]]/g;
 for(const match of text.matchAll(tokens)) {
  const token=match[0];
  if(token==='{'||token==='[') stack.push(token==='{'?new Set():null);
  else if(token==='}'||token===']') stack.pop();
  else if(/^\s*:/.test(text.slice(match.index+token.length))) {
   const key=JSON.parse(token), keys=stack.at(-1);
   if(keys?.has(key))throw new Error('Duplicate JSON key');keys?.add(key);
  }
 }
 return value;
}
async function startPersonaTransport({getSession,token,port=8766}){
 if(typeof token!=='string'||token.length<32)throw new Error('JEV_PERSONA_TOKEN must contain at least 32 characters');
 const expected=Buffer.from(`Bearer ${token}`);
 const server=http.createServer(async(req,res)=>{
  const reply=(status,body)=>{if(!res.writableEnded){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));}};
  const supplied=Buffer.from(req.headers.authorization||'');
  if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return reply(401,{error:'unauthorized'});
  if(req.headers.origin)return reply(403,{error:'browser_origin_forbidden'});
  const api=getSession()?.persona;if(!api)return reply(503,{error:'no_session'});
  try{
   const url=new URL(req.url,'http://127.0.0.1');
   if(req.method==='GET'&&url.pathname==='/voice/session'){const voice=getSession()?.voiceSession?.();return voice?reply(200,voice):reply(503,{error:'voice_unavailable'});}
   if(req.method==='GET'&&url.pathname==='/snapshot')return reply(200,api.snapshot());
   if(req.method==='GET'&&url.pathname==='/events'){
    const after=Number(url.searchParams.get('after')||0);if(!Number.isSafeInteger(after)||after<0)return reply(400,{error:'invalid_cursor'});return reply(200,api.events(after));
   }
   if(req.method!=='POST'||!['/goal','/cancel','/chat'].includes(url.pathname))return reply(404,{error:'not_found'});
   let size=0, chunks=[];for await(const chunk of req){size+=chunk.length;if(size>32768){reply(413,{error:'payload_too_large'});req.resume();return;}chunks.push(chunk);}
   const data=parseStrict(Buffer.concat(chunks).toString('utf8'));
   if(url.pathname==='/goal')return reply(200,await api.submit(data));
   if(url.pathname==='/cancel'){if(!exact(data,['goal_id'])||typeof data.goal_id!=='string')return reply(400,{error:'invalid_cancel'});return reply(200,await api.cancel(data.goal_id));}
   if(!exact(data,['text'])||!plainSpeech(data.text))return reply(400,{error:'plain_speech_required'});
   await api.chat(data.text);return reply(200,{status:'sent'});
  }catch(err){reply(400,{error:'invalid_request'});}
 });
 server.requestTimeout=5000;server.headersTimeout=5000;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});return server;
}
module.exports={startPersonaTransport,plainSpeech,parseStrict};
