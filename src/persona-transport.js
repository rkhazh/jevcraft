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
   if(req.method==='POST'&&url.pathname==='/voice/session/refresh'){
    const id=req.headers['x-persona-session'];
    if(typeof id!=='string'||id!==api.sessionId)return reply(409,{error:'stale_session'});
    const status=getSession()?.refreshVoice?.(id)||'voice_unavailable';
    return reply(status==='pending'?202:status==='rate_limited'?429:status==='stale_session'?409:503,status==='pending'?{status}:{error:status});
   }
   if(req.method==='GET'&&url.pathname==='/voice/session'){const voice=getSession()?.voiceSession?.();return voice?reply(200,voice):reply(503,{error:'voice_unavailable'});}
   if(req.method==='GET'&&url.pathname==='/vision'){
    if(req.headers['x-persona-session']!==api.sessionId)return reply(409,{error:'stale_session'});
    try{const frame=await getSession().captureVision();if(frame.session_id!==api.sessionId||getSession()?.persona?.sessionId!==api.sessionId)return reply(409,{error:'stale_session'});return reply(200,frame);}catch(err){return reply(err.code==='vision_rate_limited'?429:503,{error:err.code||'vision_unavailable'});}
   }
   if(req.method==='GET'&&url.pathname==='/snapshot')return reply(200,api.snapshot());
   if(req.method==='GET'&&url.pathname==='/events'){
    const after=Number(url.searchParams.get('after')||0);if(!Number.isSafeInteger(after)||after<0)return reply(400,{error:'invalid_cursor'});return reply(200,api.events(after));
   }
   if(req.method!=='POST'||!['/goal','/cancel','/chat','/voice/state','/look','/persona-profile','/persona-context','/reaction','/persona-action/choose'].includes(url.pathname))return reply(404,{error:'not_found'});
   let size=0, chunks=[];for await(const chunk of req){size+=chunk.length;if(size>32768){reply(413,{error:'payload_too_large'});req.resume();return;}chunks.push(chunk);}
   const data=parseStrict(Buffer.concat(chunks).toString('utf8'));
   if(url.pathname==='/persona-action/choose'){
    const id=req.headers['x-persona-session'];
    if(id!==api.sessionId||getSession()?.persona!==api)return reply(409,{error:'stale_session'});
    if(!api.actions)return reply(409,{error:'continuing_unavailable'});
    const selected=await api.actions.choose(data);
    if(getSession()?.persona!==api)return reply(409,{error:'stale_session'});
    return reply(200,selected);
   }
   if(url.pathname==='/reaction'){
    const id=req.headers['x-persona-session'];
    if(id!==api.sessionId||getSession()?.persona!==api)return reply(409,{error:'stale_session'});
    if(typeof api.react!=='function')return reply(200,{status:'rejected',reason:'reaction_unavailable',session_id:id});
    const selected=await api.react(data,id);
    if(getSession()?.persona!==api)return reply(409,{error:'stale_session'});
    return reply(200,selected);
   }
   if(url.pathname==='/persona-profile'||url.pathname==='/persona-context'){
    const id=req.headers['x-persona-session'];
    if(id!==api.sessionId||getSession()?.persona!==api)return reply(409,{error:'stale_session'});
    return reply(200,url.pathname==='/persona-context'?api.setSharedContext(data,id):api.setProfile(data,id));
   }
   if(url.pathname==='/look'){
    if(req.headers['x-persona-session']!==api.sessionId)return reply(409,{error:'stale_session'});
    if(!exact(data,['target']))return reply(400,{error:'invalid_look'});
    try{return reply(200,await getSession().lookVision(data.target));}catch(err){return reply(err.code==='look_busy'?409:400,{error:err.code||'look_unavailable'});}
   }
   if(url.pathname==='/voice/state'){
    const id=req.headers['x-persona-session'],generation=req.headers['x-voice-generation'];
    if(typeof id!=='string'||id!==api.sessionId)return reply(409,{error:'stale_session'});
    if(typeof generation!=='string'||!generation)return reply(409,{error:'stale_generation'});
    if(!exact(data,['muted','disabled'])||typeof data.muted!=='boolean'||typeof data.disabled!=='boolean')return reply(400,{error:'invalid_state'});
    const status=getSession()?.setVoiceState?.(id,generation,data)||'voice_unavailable';
    return reply(status==='updated'?200:status==='rate_limited'?429:status.startsWith('stale_')?409:503,status==='updated'?{status}:{error:status});
   }
   if(url.pathname==='/goal')return reply(200,await api.submit(data));
   if(url.pathname==='/cancel'){if(!exact(data,['goal_id'])||typeof data.goal_id!=='string')return reply(400,{error:'invalid_cancel'});return reply(200,await api.cancel(data.goal_id));}
   if(!exact(data,['text'])||!plainSpeech(data.text))return reply(400,{error:'plain_speech_required'});
   const speechSession=req.headers['x-persona-session'];
   // Older clients may omit this fence. A scoped reply must still belong to
   // this exact session after body parsing; real persona.chat sends synchronously.
   if(speechSession!==undefined&&(speechSession!==api.sessionId||getSession()?.persona!==api))return reply(409,{error:'stale_session'});
   await api.chat(data.text);return reply(200,{status:'sent'});
  }catch(err){reply(400,{error:'invalid_request'});}
 });
 server.requestTimeout=5000;server.headersTimeout=5000;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});return server;
}
module.exports={startPersonaTransport,plainSpeech,parseStrict};
