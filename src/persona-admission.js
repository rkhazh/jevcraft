'use strict';
const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join() === [...keys].sort().join();
const stable = v => JSON.stringify(v && typeof v === 'object' ? (Array.isArray(v) ? v.map(x=>JSON.parse(stable(x))) : Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(stable(v[k]))]))) : v);
function createPersona({read, start, stop, impossible=()=>false, checkBuild=()=>false, verifyBuild=()=>false, items=[], players=[], worldId='local',rendezvous=null}) {
 rendezvous=require('./persona-rendezvous').validateRendezvous(rendezvous);
 const sessionId=randomUUID(), observations=new Map(), seen=new Map(), log=[];
 let active=null, sequence=0, closed=false, serial=Promise.resolve();
 const enqueue=fn=>{const p=serial.then(fn);serial=p.catch(()=>{});return p};
 function emit(data) { const event={...data,event_id:randomUUID(),session_id:sessionId,sequence:++sequence,observed_at:Date.now()/1000}; log.push(event);if(log.length>1000)log.shift();return event; }
 function snapshot() {
  const state=read(), id=randomUUID(), now=Date.now()/1000;
  observations.set(id,{at:now,mono:performance.now()});for(const [key,v] of observations)if(now-v.at>5||observations.size>128)observations.delete(key);
  return {...state,rendezvous:rendezvous?structuredClone(rendezvous):null,items:items.filter(i=>state.items.includes(i)),players:state.players.slice(0,128),session_id:sessionId,observation_id:id,observed_at:now,world_id:worldId,active_goal_id:active?.proposal.goal_id??null};
 }
 function valid(id) {return !closed && active?.proposal.goal_id===id && active.deadline>performance.now();}
 async function cancelNow(id, status='cancelled') {
  if(!active || active.proposal.goal_id!==id)return {status:'ignored',goal_id:id};
  const old=active; active=null;clearTimeout(old.timer);
  await stop(id,status); emit({type:'goal',goal_id:id,status,summary:`Persona goal ${status}`,verified:false});return {status,goal_id:id};
 }
 function rejection(p,reason){const detail=typeof reason==='object'?reason.detail:undefined;reason=typeof reason==='object'?reason.reason:reason;return {status:'rejected',reason,...(detail?{detail}:{}),goal_id:p?.goal_id??null,session_id:sessionId};}
 function check(p) {
  if(!exact(p,['schema_version','goal_id','persona_id','session_id','observation_id','issued_at','expires_at','state','spec']))return 'invalid_shape';
  if(p.schema_version!==1||p.state!=='proposed'||typeof p.goal_id!=='string'||!/^[0-9a-f-]{36}$/i.test(p.goal_id)||typeof p.persona_id!=='string'||!p.persona_id.length||p.persona_id.length>128)return 'invalid_envelope';
  if(closed||p.session_id!==sessionId)return 'wrong_session';
  const now=Date.now()/1000, observation=observations.get(p.observation_id);
  if(!Number.isFinite(p.issued_at)||!Number.isFinite(p.expires_at)||p.issued_at>now+1||p.expires_at<=now||p.expires_at-p.issued_at>120||p.expires_at<=p.issued_at)return 'expired';
  if(!observation||performance.now()-observation.mono>5000)return 'stale_observation';
  const state=read();if(!state.connected||state.health<8||!['overworld','minecraft:overworld'].includes(state.dimension))return 'unsafe_state';
  const s=p.spec;
  if(['obtain','craft'].includes(s?.kind)) {if(!exact(s,['kind','item','count','deliver'])||!items.includes(s.item)||!state.items.includes(s.item)||!Number.isInteger(s.count)||s.count<1||s.count>64||s.deliver!==false)return 'unsupported_spec';}
  else if(['follow','come'].includes(s?.kind)){if(!exact(s,['kind','target'])||!players.includes(s.target)||(!state.players.includes(s.target)&&!(s.kind==='come'&&rendezvous?.target===s.target&&['overworld','minecraft:overworld'].includes(state.dimension))))return 'unsupported_spec';}
  else if(s?.kind==='build') {
   if(!exact(s,['kind','request','mode','build_id','schematic',...(Object.hasOwn(s,'site_binding')?['site_binding']:[])])||typeof s.request!=='string'||!s.request.trim()||s.request.length>800||/[\p{Cc}\p{Cf}]/u.test(s.request)||!['fresh','finish','repair','edit'].includes(s.mode)||(s.build_id!==null&&(typeof s.build_id!=='string'||s.build_id.length>128)))return 'unsupported_spec';
   try{if(!checkBuild(s,`persona:${p.persona_id}`))return 'unsupported_build';}catch(err){if(!err.code&&typeof err.validationDetail==='string')return {reason:'invalid_build_geometry',detail:err.validationDetail.replace(/[\p{Cc}\p{Cf}]/gu,' ').slice(0,240)};return err.code||'invalid_build_geometry';}
  }
  else return 'unsupported_spec';
  if(impossible(s))return 'unworkable';return null;
 }
 async function submitNow(p) {
  const fingerprint=stable(p), previous=seen.get(p?.goal_id);
  if(previous)return previous.fingerprint===fingerprint?previous.result:rejection(p,'id_conflict');
  let reason=check(p);if(reason)return rejection(p,reason);
  if(seen.size>=10000)return rejection(p,'session_capacity');
  if(active)await cancelNow(active.proposal.goal_id,'cancelled');
  reason=check(p);if(reason)return rejection(p,reason);
  const current={proposal:structuredClone(p),deadline:performance.now()+(p.expires_at-Date.now()/1000)*1000};active=current;
  current.timer=setTimeout(()=>enqueue(()=>cancelNow(p.goal_id,'expired')).catch(()=>{}),Math.max(1,current.deadline-performance.now()));current.timer.unref();
  try{await start({...p.spec,...(p.spec.kind==='come'&&rendezvous?.target===p.spec.target?{requesterPosition:{...rendezvous.position}}:{}),personaGoalId:p.goal_id,personaId:p.persona_id,from:`persona:${p.persona_id}`,request:p.spec.kind==='build'?p.spec.request:['obtain','craft'].includes(p.spec.kind)?`${p.spec.kind} ${p.spec.count} ${p.spec.item}`:`${p.spec.kind} ${p.spec.target}`});}
  catch(err){await cancelNow(p.goal_id,'failed');return rejection(p,'start_failed');}
  if(!valid(p.goal_id)){await cancelNow(p.goal_id,'expired');return rejection(p,'expired');}
  const result={status:'accepted',goal_id:p.goal_id,session_id:sessionId,expires_at:p.expires_at};seen.set(p.goal_id,{fingerprint,result});emit({type:'goal',goal_id:p.goal_id,status:'accepted',summary:'Goal admitted',verified:false});return result;
 }
 return {get sessionId(){return sessionId;},snapshot,valid,emit,submit:p=>enqueue(()=>submitNow(p)),cancel:id=>enqueue(()=>cancelNow(id)),
  events(after) {
   const pending=log.filter(e=>e.sequence>after);
   const packet={events:[],cursor:after,oldest_sequence:log[0]?.sequence??sequence,has_more:false};
   let eventBytes=0;
   for(const event of pending) {
    const bytes=Buffer.byteLength(JSON.stringify(event),'utf8');
    // Count serialized UTF-8 bytes including commas and the full envelope.
    // Reserve the longer false literal, so the final has_more value always fits.
    const envelope=Buffer.byteLength(JSON.stringify({...packet,events:[],cursor:event.sequence,has_more:false}),'utf8');
    if(envelope+eventBytes+bytes+packet.events.length>65536)break;
    packet.events.push(event);packet.cursor=event.sequence;eventBytes+=bytes;
   }
   packet.has_more=packet.events.length<pending.length;
   return packet;
  },
  finish(id,status,goal){if(!valid(id))return;const s=active.proposal.spec;let verified=false;
   if(status==='complete'){
    const state=read();
    verified=['obtain','craft'].includes(s.kind)&&(state.inventory[s.item]||0)>=s.count;
    if(s.kind==='come'){
     const here=state.position, there=state.player_positions?.[s.target];
     verified=!!here&&!!there&&Math.hypot(here.x-there.x,here.y-there.y,here.z-there.z)<=3;
    }
    if(s.kind==='build')verified=!!verifyBuild(goal);
    if(!verified)status='failed';
   }
   if(!['complete','blocked','failed'].includes(status))return;
   clearTimeout(active.timer);active=null;emit({type:'goal',goal_id:id,status,verified,...(goal?.buildId?{build_id:goal.buildId}:{}),...(goal?.personaBuildVerification?{build_verification:goal.personaBuildVerification}:{}),summary:verified?(s.kind==='build'?(goal.personaBuildVerification?.retained_blocks?`Verified structure ${goal.buildId} with ${goal.personaBuildVerification.retained_blocks} observed retained enclosed original natural foundation cells; not an exact material match`:`Verified all planned structure blocks and clear cells for ${goal.buildId}`):s.kind==='come'?`Observed arrival within 3 blocks of ${s.target}`:`Observed at least ${s.count} ${s.item} in inventory`):`Goal ${status}`});
  },
  close:()=>{closed=true;return enqueue(async()=>{if(active)await cancelNow(active.proposal.goal_id,'cancelled');});},
 };
}
module.exports={createPersona,exact};
