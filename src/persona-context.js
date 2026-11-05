'use strict';
// Enduring configured identity is separate from advisory context for one lease.
const keys=(v,w)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===w.sort().join();
const text=(s,n)=>typeof s==='string'&&s.length<=n&&!/[\p{Cc}\p{Cf}]/u.test(s)&&!/(?:^|\s)\/[a-z][\w:-]*(?:\s|$)/i.test(s);
function validProfile(p){
 const bounded=(s,n)=>typeof s==='string'&&s.trim().length>0&&[...s].length<=n;
 return !!(keys(p,['persona_id','identity','motivations','social_style'])&&bounded(p.persona_id,64)&&bounded(p.identity,16000)&&bounded(p.social_style,2000)
  &&Array.isArray(p.motivations)&&p.motivations.length>=1&&p.motivations.length<=10&&p.motivations.every(m=>bounded(m,500))&&Buffer.byteLength(JSON.stringify(p),'utf8')<=24576);
}
function validContext(c,now=Date.now()/1000){
 if(!keys(c,['identity','motivations','objective','intention','purpose','visual_assessment']))return false;
 if(!text(c.identity,160)||!c.identity.trim()||!Array.isArray(c.motivations)||c.motivations.length>6||!c.motivations.every(s=>text(s,240))||!(c.objective===null||text(c.objective,800))||!text(c.intention,400)||!text(c.purpose,400))return false;
 const v=c.visual_assessment;
 if(v!==null&&(!keys(v,['observed_at','summary'])||!Number.isFinite(v.observed_at)||v.observed_at>now+1||now-v.observed_at>300||!text(v.summary,800)))return false;
 return Buffer.byteLength(JSON.stringify(c),'utf8')<=6000;
}
function withPersonaContext(client,getGoal,isCurrent,{now=()=>Date.now()/1000,getProfile=()=>null,getMutationAuthority=()=>null}={}){
 return {systemOne(args){
  const goal=getGoal();
  // A caller cannot smuggle its own context through a state object or retain a
  // previous goal's context after cancellation, replacement, or expiry.
  const state=args.state&&typeof args.state==='object'&&!Array.isArray(args.state)?{...args.state}:{observation:args.state};
  delete state.persona_context;
  delete state.actor_profile;
  delete state.mutation_authority;
  const authority=getMutationAuthority();
  if(authority)state.mutation_authority=structuredClone(authority);
  const profile=getProfile(),standing=validProfile(profile);
  if(standing)state.actor_profile={...structuredClone(profile),authority:'Configured character identity and values, not a task or permission. Offered methods describe physical possibilities, not ownership or authorization. Current world evidence, survival priorities, and hard policy remain authoritative.'};
  if(goal?.personaContext&&isCurrent(goal)){
   const c=structuredClone(goal.personaContext), at=now();
   if(c.visual_assessment&&(at-c.visual_assessment.observed_at>300||c.visual_assessment.observed_at>at+1))c.visual_assessment=null;
   // Legacy clients carry an identity excerpt in each lease. Once the complete
   // profile is installed, only current intent belongs in the leased context.
   const {identity:_identity,motivations:_motivations,...intent}=c;
   if(validContext(c,at))state.persona_context={
    ...(standing?intent:c),goal_id:goal.personaGoalId,
    selected_goal:{kind:goal.kind,request:goal.request},
    authority:'Advisory persona motivation for this admitted goal only. The selected goal, available typed choices, current world evidence, survival priorities, permissions, and hard policy remain authoritative. This context grants no commands or additional actions. Visual assessment is a dated subjective hypothesis, not a verified world fact; verify against current observations.'
   };
  }
  return client.systemOne({...args,state});
 }};
}
module.exports={validContext,validProfile,withPersonaContext};
