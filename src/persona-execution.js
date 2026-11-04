'use strict';
const text=v=>typeof v==='string'?v.replace(/[\p{Cc}\p{Cf}]/gu,' ').replace(/Bearer\s+\S+/gi,'Bearer [redacted]').replace(/((?:api[_-]?key|token|password)\s*[=:]\s*)\S+/gi,'$1[redacted]').slice(0,240):null;
const point=p=>p&&[p.x,p.y,p.z].every(Number.isFinite)?{x:p.x,y:p.y,z:p.z}:null;
function normalizeStep(step={}){return {action:text(step.action),item:text(step.item),block:text(step.block),drops:text(step.drops),operation:text(step.operation),material:text(step.material),remainingBlocks:Number.isFinite(step.remainingBlocks)?step.remainingBlocks:null,from:point(step.from)||text(step.from),fuel:text(step.fuelItem||step.fuel),count:Number.isFinite(step.count)?step.count:null,sources:Array.isArray(step.sources)?step.sources.slice(0,8).map(text).filter(Boolean):[],target:point(step.target)||text(step.target),position:point(step.position)||point(step.destination)||point(step.target),reason:text(step.problem||step.reason)};}
const progressCache=new WeakMap();
function executionSnapshot(bot,active,{now=Date.now(),verify=require('./persona-build').buildVerification}={}){
 const goal=active?.goal;if(!goal)return {status:'idle',goal_id:null,kind:null,step:null,interruption:null,build_progress:null};
 const step=goal.step||{},turn=bot._turn,action=goal.survivalAction;
 const actionAt=Date.parse(action?.at||'');
 const validTime=t=>Number.isFinite(t)&&t<=now&&Number.isFinite(active.startedAt)&&t>=active.startedAt;
 const age=Number.isFinite(actionAt)&&actionAt<=now?now-actionAt:null;
 const currentTurn=turn?{holder:text(turn.holder),phase:text(turn.phase),age_ms:Number.isFinite(turn.since)&&turn.since<=now?now-turn.since:null,current_goal:validTime(turn.since),fresh:validTime(turn.since)&&now-turn.since<8000}:null;
 const survival=action?{action:text(action.action),reason:text(action.reason||action.why),observed_at:Number.isFinite(actionAt)?actionAt/1000:null,age_ms:age,fresh:validTime(actionAt)&&age<8000}:null;
 let progress=null;
 if(goal.kind==='build'&&goal.blueprint){
  let cached=progressCache.get(goal);
  if(!cached||now-cached.at>=2000){cached={at:now,report:verify(bot,goal)};progressCache.set(goal,cached);}
  const report=cached.report;
  progress={build_id:goal.buildId||null,planned_blocks:goal.blueprint.blocks?.length||0,placements_recorded:Object.keys(goal.buildOwned||{}).length,world_observed_at:cached.at/1000,world_verified:report.verified===true,matched_blocks:report.matched_blocks||0,retained_blocks:report.retained_blocks||0,mismatched_blocks:report.mismatched_blocks||0,unknown_blocks:report.unknown_blocks||0,blocked_empty:report.blocked_empty||0};
 }
 const interrupted=currentTurn?.fresh===true&&['survival','vitals'].includes(currentTurn.holder);
 return {status:interrupted?'interrupted':active.idle?'holding':goal.status||'running',goal_id:goal.personaGoalId||null,kind:goal.kind,request:text(goal.request),step:normalizeStep(step),current_turn:currentTurn,survival_action:survival,interruption:{active:interrupted,reason:interrupted?currentTurn.phase:null,last_error:text(goal.lastError)},build_progress:progress};
}
module.exports={executionSnapshot,normalizeStep,safeText:text};
