'use strict';
const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join() === [...keys].sort().join();
const stable = v => JSON.stringify(v && typeof v === 'object' ? (Array.isArray(v) ? v.map(x=>JSON.parse(stable(x))) : Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(stable(v[k]))]))) : v);
function createPersona({read, start, stop, reaction=null, decisionMode='legacy', impossible=()=>false, checkBuild=()=>false, verifyBuild=()=>false, items=[], players=[], worldId='local',rendezvous=null,allowVisiblePlayers=false,allowLocalMove=false,checkMove=()=>false,movementAffordances=()=>({}),visitAffordances=()=>({enabled:false,destinations:[]}),resolveVisit=()=>null,verifyVisit=()=>false,craftAffordances=()=>({enabled:false,items:[]}),checkCraft=()=>false,checkEdit=()=>false,verifyEdit=()=>false}) {
 rendezvous=require('./persona-rendezvous').validateRendezvous(rendezvous);
 const sessionId=randomUUID(), observations=new Map(), seen=new Map(), log=[];
 let active=null, lastResult=null, sequence=0, closed=false, serial=Promise.resolve(), actorProfile=null, sharedMemory=null;
 function setProfile(profile,id){
  const rejected=reason=>({status:'rejected',reason,session_id:sessionId});
  if(closed||id!==sessionId)return rejected('wrong_session');
  if(!require('./persona-context').validProfile(profile))return rejected('invalid_persona_profile');
  if(actorProfile&&stable(actorProfile)!==stable(profile))return rejected('profile_already_set');
  if(active&&active.proposal.persona_id!==profile.persona_id)return rejected('wrong_persona');
  actorProfile=structuredClone(profile);
  return {status:'ready',session_id:sessionId,persona_id:profile.persona_id};
 }
 function setSharedContext(context,id){
  const rejected=reason=>({status:'rejected',reason,session_id:sessionId});
  if(closed||id!==sessionId)return rejected('wrong_session');
  if(!require('./persona-context').validSharedContext(context))return rejected('invalid_shared_context');
  if(context.session_id!==sessionId)return rejected('wrong_session');
  if(context.world_id!==worldId)return rejected('wrong_world');
  if(!actorProfile)return rejected('profile_required');
  if(context.persona_id!==actorProfile.persona_id)return rejected('wrong_persona');
  const now=Date.now()/1000;
  if(context.observed_at>now+1||now-context.observed_at>10)return rejected('expired');
  if(sharedMemory&&context.revision<sharedMemory.revision)return rejected('stale_revision');
  if(sharedMemory&&context.revision===sharedMemory.revision&&stable(context)!==stable(sharedMemory))return rejected('revision_conflict');
  sharedMemory=structuredClone(context);
  return {status:'ready',session_id:sessionId,revision:context.revision};
 }
 const enqueue=fn=>{const p=serial.then(fn);serial=p.catch(()=>{});return p};
 function emit(data) { const event={...data,event_id:randomUUID(),session_id:sessionId,sequence:++sequence,observed_at:Date.now()/1000}; if(data.type==='goal'&&['complete','blocked','failed','expired','cancelled'].includes(data.status))lastResult=structuredClone(event); log.push(event);if(log.length>1000)log.shift();return event; }
 function snapshot() {
  const state={...read(),decision_loop:{supported:true,mode:decisionMode},actor_profile:{supported:true,persona_id:closed?null:actorProfile?.persona_id??null},shared_context:{supported:true,revision:sharedMemory?.revision??0},...(typeof reaction==='function'?{reaction_capabilities:{enabled:!closed}}:{})}, id=randomUUID(), now=Date.now()/1000;
  const craft=craftAffordances(actorProfile?.persona_id??null);
  const visit=visitAffordances(actorProfile?`persona:${actorProfile.persona_id}`:null);
  observations.set(id,{at:now,mono:performance.now(),visit:structuredClone(visit),craft:structuredClone(craft)});for(const [key,v] of observations)if(now-v.at>5||observations.size>128)observations.delete(key);
  return {...state,craft_capabilities:craft,last_result:lastResult?structuredClone(lastResult):null,movement_capabilities:{allow_visible_players:allowVisiblePlayers,local_move:{...movementAffordances(),enabled:allowLocalMove,max_distance:16,arrival_distance:1.5},visit},rendezvous:rendezvous?structuredClone(rendezvous):null,items:items.filter(i=>state.items.includes(i)),players:state.players.slice(0,128),session_id:sessionId,observation_id:id,observed_at:now,world_id:worldId,active_goal_id:active?.proposal.goal_id??null};
 }
 function valid(id) {return !closed && active?.proposal.goal_id===id && active.deadline>performance.now();}
 function terminalDetails(spec,goal) {
  const {normalizeStep,safeText}=require('./persona-execution');
  return {reason:safeText(goal?.lastError||goal?.step?.problem||goal?.step?.reason),
   execution:{kind:spec.kind,request:safeText(goal?.request||spec.request),step:normalizeStep(goal?.step||{})},
   ...(goal?.buildId?{build_id:goal.buildId}:{}),
   ...(goal?.personaBuildVerification?{build_verification:goal.personaBuildVerification}:{}),
   ...(goal?.visitArrival?{visit_arrival:goal.visitArrival}:{}),...(goal?.editVerification?{edit_verification:goal.editVerification}:{})};
 }
 async function cancelNow(id, status='cancelled') {
  if(!active || active.proposal.goal_id!==id)return {status:'ignored',goal_id:id};
  const old=active; active=null;clearTimeout(old.timer);
  const stopped=await stop(id,status);
  // A stopped lease can have created a real project before the observer saw
  // its first snapshot. Preserve that scoped fact across expiry/restart; it
  // establishes identity only, never successful completion.
  const goal=stopped?.personaGoalId===id&&stopped?.from===`persona:${old.proposal.persona_id}`&&stopped?.kind===old.proposal.spec.kind?stopped:null;
  emit({type:'goal',goal_id:id,status,...terminalDetails(old.proposal.spec,goal),summary:`Persona goal ${status}`,verified:false});return {status,goal_id:id};
 }
 function rejection(p,reason){const detail=typeof reason==='object'?reason.detail:undefined;reason=typeof reason==='object'?reason.reason:reason;return {status:'rejected',reason,...(detail?{detail}:{}),goal_id:p?.goal_id??null,session_id:sessionId};}
 function check(p) {
  if(!exact(p,['schema_version','goal_id','persona_id','session_id','observation_id','issued_at','expires_at','state','spec',...(Object.hasOwn(p||{},'persona_context')?['persona_context']:[])]))return 'invalid_shape';
  if(p.schema_version!==1||p.state!=='proposed'||typeof p.goal_id!=='string'||!/^[0-9a-f-]{36}$/i.test(p.goal_id)||typeof p.persona_id!=='string'||!p.persona_id.length||p.persona_id.length>128)return 'invalid_envelope';
  if(Object.hasOwn(p,'persona_context')&&!require('./persona-context').validContext(p.persona_context))return 'invalid_persona_context';
  if(closed||p.session_id!==sessionId)return 'wrong_session';
  if(actorProfile&&p.persona_id!==actorProfile.persona_id)return 'wrong_persona';
  const now=Date.now()/1000, observation=observations.get(p.observation_id);
  if(!Number.isFinite(p.issued_at)||!Number.isFinite(p.expires_at)||p.issued_at>now+1||p.expires_at<=now||p.expires_at-p.issued_at>120||p.expires_at<=p.issued_at)return 'expired';
  if(!observation||performance.now()-observation.mono>5000)return 'stale_observation';
  const state=read();if(!state.connected||state.health<8||!['overworld','minecraft:overworld'].includes(state.dimension))return 'unsafe_state';
  const s=p.spec;let continuingCraft=false;
  if(['obtain','craft'].includes(s?.kind)) {
   if(!exact(s,['kind','item','count','deliver'])||!state.items.includes(s.item)||!Number.isInteger(s.count)||s.count<1||s.count>64||s.deliver!==false)return 'unsupported_spec';
   if(s.kind==='craft'&&observation.craft?.enabled){
    if((!observation.craft.items?.includes(s.item)&&!observation.craft.pending_work?.some(w=>w.item===s.item&&w.count===s.count))||!craftAffordances(p.persona_id).enabled)return 'unsupported_craft';
    try{const prepared=checkCraft(s,p.persona_id,observation.craft);if(!prepared)return 'craft_inputs_unavailable';continuingCraft=!!prepared.continuation;}catch(error){return {reason:error.code||'craft_inputs_unavailable',detail:String(error.message).slice(0,240)};}
   }else if(!items.includes(s.item))return 'unsupported_spec';
  }
  else if(['follow','come'].includes(s?.kind)){if(!exact(s,['kind','target'])||!(players.includes(s.target)||(allowVisiblePlayers&&state.players.includes(s.target)&&state.player_identities?.some(p=>p.name===s.target&&/^[0-9a-f-]{36}$/i.test(p.uuid))))||(!state.players.includes(s.target)&&!(s.kind==='come'&&rendezvous?.target===s.target&&['overworld','minecraft:overworld'].includes(state.dimension))))return 'unsupported_spec';}
  else if(s?.kind==='move'){if(!allowLocalMove||!exact(s,['kind','target'])||!exact(s.target,['x','y','z'])||![s.target.x,s.target.y,s.target.z].every(Number.isFinite)||!checkMove(s.target))return 'unsupported_move';if(state.position&&Math.hypot(state.position.x-s.target.x,state.position.y-s.target.y,state.position.z-s.target.z)<=1.5)return 'already_at_move_target';}
  else if(s?.kind==='visit'){
   if(!exact(s,['kind','target'])||typeof s.target!=='string'||s.target.length>128||!observation.visit?.enabled)return 'unsupported_visit';
   const advertised=observation.visit.destinations?.find(d=>d.id===s.target),current=resolveVisit(s.target,`persona:${p.persona_id}`),api=require('./persona-visit');
   if(!advertised)return 'unadvertised_visit_destination';
   if(!api.destinationMatches(advertised,current))return 'stale_visit_destination';
   const here=state.position,dim=require('./memory').dimension(state.dimension),d=here&&Math.hypot(here.x-current.position.x,here.y-current.position.y,here.z-current.position.z);
   if(!Number.isFinite(d)||dim!==current.dimension||d>api.MAX_DISTANCE)return 'unsupported_visit';
   if(d<=api.ARRIVAL_DISTANCE)return 'already_near_visit_destination';
  }
  else if(s?.kind==='edit'){try{if(!checkEdit(s))return 'unsupported_edit';}catch(error){return {reason:error.code||'edit_not_admissible',detail:String(error.message).slice(0,240)};}}
  else if(s?.kind==='build') {
   if(!exact(s,['kind','request','mode','build_id','schematic',...(Object.hasOwn(s,'site_binding')?['site_binding']:[])])||typeof s.request!=='string'||!s.request.trim()||s.request.length>800||/[\p{Cc}\p{Cf}]/u.test(s.request)||!['fresh','finish','repair','edit'].includes(s.mode)||(s.build_id!==null&&(typeof s.build_id!=='string'||s.build_id.length>128)))return 'unsupported_spec';
   try{if(!checkBuild(s,`persona:${p.persona_id}`))return 'unsupported_build';}catch(err){if(!err.code&&typeof err.validationDetail==='string')return {reason:'invalid_build_geometry',detail:err.validationDetail.replace(/[\p{Cc}\p{Cf}]/gu,' ').slice(0,240)};return err.code||'invalid_build_geometry';}
  }
  else return 'unsupported_spec';
  if(!continuingCraft&&impossible(s))return 'unworkable';return null;
 }
 async function submitNow(p) {
  const fingerprint=stable(p), previous=seen.get(p?.goal_id);
  if(previous)return previous.fingerprint===fingerprint?previous.result:rejection(p,'id_conflict');
  let reason=check(p);if(reason)return rejection(p,reason);
  if(seen.size>=10000)return rejection(p,'session_capacity');
  if(active)await cancelNow(active.proposal.goal_id,'cancelled');
  reason=check(p);if(reason)return rejection(p,reason);
  const admittedAt=Date.now(),expiresAt=p.spec.kind==='visit'?Math.min(p.expires_at,(admittedAt+60000)/1000):p.expires_at;
  const destination=p.spec.kind==='visit'?structuredClone(resolveVisit(p.spec.target,`persona:${p.persona_id}`)):null;
  const visit=destination?{destination,personaVisitPolicy:{destination:structuredClone(destination),startedAt:admittedAt},navigationOnly:true,personaHold:true}:{};
  const advertisedCraft=observations.get(p.observation_id)?.craft;
  let craft={};
  if(p.spec.kind==='craft'&&advertisedCraft?.enabled){
   let prepared;try{prepared=checkCraft(p.spec,p.persona_id,advertisedCraft);}catch(error){return rejection(p,{reason:error.code||'craft_inputs_unavailable',detail:String(error.message).slice(0,240)});}
   craft={personaCraftPolicy:{source:'carried_inventory'},personaHold:true,...(prepared?.continuation?{personaCraftContinuation:structuredClone(prepared.continuation)}:{})};
  }
  const current={proposal:structuredClone(p),deadline:performance.now()+(expiresAt-Date.now()/1000)*1000};active=current;
  current.timer=setTimeout(()=>enqueue(()=>cancelNow(p.goal_id,'expired')).catch(()=>{}),Math.max(1,current.deadline-performance.now()));current.timer.unref();
  try{await start({...p.spec,...visit,...craft,...(p.spec.kind==='come'&&rendezvous?.target===p.spec.target?{requesterPosition:{...rendezvous.position}}:{}),...(p.persona_context?{personaContext:structuredClone(p.persona_context)}:{}),personaGoalId:p.goal_id,personaSessionId:sessionId,personaId:p.persona_id,personaWorldId:worldId,from:`persona:${p.persona_id}`,request:p.spec.kind==='build'?p.spec.request:p.spec.kind==='move'?`Move locally to (${p.spec.target.x}, ${p.spec.target.y}, ${p.spec.target.z})`:p.spec.kind==='visit'?`Visit the last-known reference for ${destination.label}`:['obtain','craft'].includes(p.spec.kind)?`${p.spec.kind} ${p.spec.count} ${p.spec.item}`:`${p.spec.kind} ${p.spec.target}`});}
  catch(err){await cancelNow(p.goal_id,'failed');return rejection(p,'start_failed');}
  if(!valid(p.goal_id)){await cancelNow(p.goal_id,'expired');return rejection(p,'expired');}
  const result={status:'accepted',goal_id:p.goal_id,session_id:sessionId,expires_at:expiresAt};seen.set(p.goal_id,{fingerprint,result});emit({type:'goal',goal_id:p.goal_id,status:'accepted',summary:'Goal admitted',verified:false});return result;
 }
 return {get sessionId(){return sessionId;},snapshot,valid,emit,canPropose:spec=>{const s=snapshot();return check({schema_version:1,goal_id:randomUUID(),persona_id:actorProfile?.persona_id||'unknown',session_id:sessionId,observation_id:s.observation_id,issued_at:s.observed_at,expires_at:s.observed_at+60,state:'proposed',spec});},submit:p=>enqueue(()=>submitNow(p)),cancel:id=>enqueue(()=>cancelNow(id)),
  ...(typeof reaction==='function'?{react:reaction}:{}),
  get actorProfile(){return !closed&&actorProfile?structuredClone(actorProfile):null;},setProfile,
  get sharedContext(){const now=Date.now()/1000;return !closed&&sharedMemory&&sharedMemory.observed_at<=now+1&&now-sharedMemory.observed_at<=30?structuredClone(sharedMemory):null;},setSharedContext,
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
    if(s.kind==='move'){const p=state.position;verified=!!p&&['overworld','minecraft:overworld'].includes(state.dimension)&&Math.hypot(p.x-s.target.x,p.y-s.target.y,p.z-s.target.z)<=1.5&&checkMove(s.target);}
    if(s.kind==='edit')verified=!!verifyEdit(goal);
    if(s.kind==='build')verified=!!verifyBuild(goal);
    if(s.kind==='visit')verified=!!verifyVisit(goal);
    if(!verified)status='failed';
   }
   if(!['complete','blocked','failed'].includes(status))return;
   const details=terminalDetails(s,goal);
   clearTimeout(active.timer);active=null;emit({type:'goal',goal_id:id,status,verified,...details,summary:verified?(s.kind==='edit'?'Observed all exact edit targets and preserved cells':s.kind==='build'?(goal.personaBuildVerification?.retained_blocks?`Verified structure ${goal.buildId} with ${goal.personaBuildVerification.retained_blocks} observed retained enclosed original natural foundation cells; not an exact material match`:`Verified all planned structure blocks and clear cells for ${goal.buildId}`):s.kind==='move'?`Observed arrival within 1.5 blocks of requested local point`:s.kind==='visit'?`Observed arrival within 3 blocks of the last-known destination reference; current existence and access unverified`:s.kind==='come'?`Observed arrival within 3 blocks of ${s.target}`:`Observed at least ${s.count} ${s.item} in inventory`):`Goal ${status}${details.reason?`: ${details.reason}`:""}`});
  },
  close:()=>{closed=true;return enqueue(async()=>{if(active)await cancelNow(active.proposal.goal_id,'cancelled');});},
 };
}
module.exports={createPersona,exact};
