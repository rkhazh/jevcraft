'use strict';
// Operational evidence, independent of the current goal and snapshot polling.
// A report describes what a controller said alongside observed body state; it
// never certifies a persona objective or grants permission for another action.
const {randomUUID}=require('node:crypto');
const {safeText}=require('./persona-execution');
const {actionAttribution}=require('./action-scope');
const point=p=>p&&[p.x,p.y,p.z].every(Number.isFinite)?{x:p.x,y:p.y,z:p.z}:null;
const significant=e=>e.source==='controller_report'||['failed','interrupted'].includes(e.report?.outcome);
// Native domains share this field but do not all call Survival.report. Watch
// assignments once per goal, before execution; restored contents are history,
// not a new action. The field remains ordinary enumerable serialized data.
function observer(onReport){
 const watched=new WeakSet(),reported=new WeakMap();
 return goal=>{
  if(!goal||typeof goal!=='object'||watched.has(goal))return;
  let current=goal.survivalAction;
  if(current&&typeof current==='object')reported.set(current,JSON.stringify(details(current)));
  Object.defineProperty(goal,'survivalAction',{enumerable:true,configurable:true,
   get:()=>current,
   set:report=>{
    current=report;
    if(report&&typeof report==='object')try{
     const signature=JSON.stringify(details(report));
     // saveWork relays a child's exact report object into the parent. That is
     // transport, not a new statement by whichever controller performs the save.
     if(reported.get(report)===signature)return;
     reported.set(report,signature);onReport(report);
    }catch(err){console.error(`[persona] native evidence unavailable: ${err?.name||'Error'}`);}
   }});
  watched.add(goal);
 };
}
function statement(entry){
 const {id,observed_at,observed,...frame}=entry,report={...entry.report};
 // Some native statements repeat observed vitals. Regeneration alone is not
 // a new controller decision; scope-end snapshots retain the physical change.
 for(const key of ['health','food'])if(report[key]===observed[key])delete report[key];
 return JSON.stringify({...frame,report});
}
function retained(entries){
 const keep=new Set([...entries.filter(significant).slice(-32),...entries.filter(e=>!significant(e)).slice(-32)]);
 for(const e of [...entries].reverse())if(keep.size<64)keep.add(e);
 return entries.filter(e=>keep.has(e));
}
function value(v){
 if(typeof v==='string')return safeText(v);
 if(typeof v==='boolean'||v===null||typeof v==='number'&&Number.isFinite(v))return v;
 return point(v)||undefined;
}
function details(input){
 const out={action:safeText(input.action)};
 for(const [key,v] of Object.entries(input).slice(0,24)){
  if(key==='at'||!/^[a-z][a-z0-9_]{0,48}$/i.test(key)||/token|password|secret|credential|api.?key/i.test(key))continue;
  if(!Object.hasOwn(out,key)&&Object.keys(out).length>=24)continue;
  const cleaned=Array.isArray(v)?v.slice(0,8).map(value).filter(x=>x!==undefined):value(v);
  if(cleaned!==undefined)out[key]=cleaned;
 }
 return out;
}
function record(bot,state,report,{source,sessionId,worldId,now=Date.now(),attribution=actionAttribution(bot)}={}){
 const position=point(bot.entity?.position);
 if(!position||!sessionId||!worldId||!['controller_report','scope_end'].includes(source))return null;
 const inventory={};
 try{
  const items=bot.inventory.items();
  for(const item of items.slice(0,128))if(/^[a-z0-9_]{1,64}$/.test(item.name)&&Number.isInteger(item.count)&&item.count>=0)inventory[item.name]=(inventory[item.name]||0)+item.count;
 }catch(_){return null;}
 const observed={position,health:Number.isFinite(bot.health)?bot.health:null,food:Number.isFinite(bot.food)?bot.food:null,inventory};
 const clean=details(report);if(!clean.action)return null;
 const frame={source,source_session_id:sessionId,world_id:worldId,dimension:bot.game?.dimension||'unknown',...attribution,report:clean,observed};
 const entries=state.bodyReports||=[],last=entries.at(-1);
 const previousStatement=entries.findLast(significant);
 if(source==='controller_report'&&previousStatement?.source==='controller_report'&&statement(previousStatement)===statement(frame))return null;
 if(last){
  const {id,observed_at,...previous}=last;
  if(JSON.stringify(previous)===JSON.stringify(frame))return null;
  // Yielding without changing observed state is not a new physical event.
  if(source==='scope_end'&&clean.outcome==='yielded'&&last.source_session_id===sessionId&&JSON.stringify(last.observed)===JSON.stringify(observed))return null;
 }
 const entry={...frame,id:randomUUID(),observed_at:now/1000};
 if(Buffer.byteLength(JSON.stringify(entry))>12000)return null;
 state.bodyReports=retained([...entries,entry]);
 return structuredClone(entry);
}
function tail(state,worldId){
 const out=[];let bytes=2;
 const entries=(state.bodyReports||[]).filter(e=>e.world_id===worldId);
 const candidates=[...new Set([...entries.filter(significant).slice(-8).reverse(),...entries.slice().reverse()])];
 for(const entry of candidates){
  const size=Buffer.byteLength(JSON.stringify(entry))+1;
  if(out.length>=16)break;
  if(bytes+size>12288)continue;
  out.push(structuredClone(entry));bytes+=size;
 }
 return out.sort((a,b)=>a.observed_at-b.observed_at);
}
module.exports={record,tail,observer};
