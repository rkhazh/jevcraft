'use strict';
const text=v=>typeof v==='string'?v.replace(/[\p{Cc}\p{Cf}]/gu,' ').slice(0,240):null;
const point=p=>p&&[p.x,p.y,p.z].every(Number.isFinite)?{x:p.x,y:p.y,z:p.z}:null;
const progressCache=new WeakMap();
function executionSnapshot(bot,active,{now=Date.now(),verify=require('./persona-build').buildVerification}={}){
 const goal=active?.goal;if(!goal)return {status:'idle',goal_id:null,kind:null,step:null,interruption:null,build_progress:null};
 const step=goal.step||{},turn=bot._turn,action=goal.survivalAction;
 const actionAt=Date.parse(action?.at||'');
 const age=Number.isFinite(actionAt)?Math.max(0,now-actionAt):null;
 const currentTurn=turn?{holder:text(turn.holder),phase:text(turn.phase),age_ms:Number.isFinite(turn.since)?Math.max(0,now-turn.since):null}:null;
 const survival=action?{action:text(action.action),reason:text(action.reason||action.why),observed_at:Number.isFinite(actionAt)?actionAt/1000:null,age_ms:age,fresh:age!==null&&age<8000}:null;
 let progress=null;
 if(goal.kind==='build'&&goal.blueprint){
  let cached=progressCache.get(goal);
  if(!cached||now-cached.at>=2000){cached={at:now,report:verify(bot,goal)};progressCache.set(goal,cached);}
  const report=cached.report;
  progress={build_id:goal.buildId||null,planned_blocks:goal.blueprint.blocks?.length||0,placements_recorded:Object.keys(goal.buildOwned||{}).length,world_observed_at:cached.at/1000,world_verified:report.verified===true,matched_blocks:report.matched_blocks||0,retained_blocks:report.retained_blocks||0,mismatched_blocks:report.mismatched_blocks||0,unknown_blocks:report.unknown_blocks||0,blocked_empty:report.blocked_empty||0};
 }
 const interrupted=['survival','vitals'].includes(currentTurn?.holder);
 return {status:interrupted?'interrupted':active.idle?'holding':goal.status||'running',goal_id:goal.personaGoalId||null,kind:goal.kind,request:text(goal.request),step:{action:text(step.action),item:text(step.item),target:text(step.target),position:point(step.position||step.destination),reason:text(step.problem||step.reason)},current_turn:currentTurn,survival_action:survival,interruption:{active:interrupted,reason:interrupted?currentTurn.phase:null,last_error:text(goal.lastError)},build_progress:progress};
}
module.exports={executionSnapshot};
