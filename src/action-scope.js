'use strict';
const {AsyncLocalStorage}=require('node:async_hooks');
const actions=new AsyncLocalStorage();

// Identity follows the executing async action, not the last goal cached on the
// bot. In particular, survival can interrupt a goal without becoming that goal.
async function withActionScope(bot,controller,goal,run){
 const inherited=actions.getStore(),parent=inherited?.bot===bot&&inherited.active?inherited:null;
 const scope={bot,controller,active:true,intent:null};
 if(controller==='work'&&goal?.personaGoalId)scope.intent={goal_id:goal.personaGoalId,owner:scope};
 else if(controller!=='idle')scope.intent=parent?.intent||(!parent&&goal?.personaGoalId?{goal_id:goal.personaGoalId,owner:scope}:null);
 try{return await actions.run(scope,async()=>{
  let outcome='yielded',reason=null;
  try{return await run();}
  catch(err){outcome=['NeedsAir','NeedsSafety','Cancelled'].includes(err?.name)?'interrupted':'failed';reason=String(err?.message||err);throw err;}
  finally{
   try{bot._onActionOutcome?.({...actionAttribution(bot),outcome,reason});}
   catch(err){console.error(`[persona] action evidence unavailable: ${err.name}`);}
  }
 });}finally{scope.active=false;}
}
function actionAttribution(bot){
 const scope=actions.getStore();
 if(!scope?.active||scope.bot!==bot)return {controller:'unknown',goal_id:null,interrupted_goal_id:null};
 const id=scope.intent?.owner.active?scope.intent.goal_id:null;
 return {controller:scope.controller,goal_id:scope.controller==='work'?id:null,interrupted_goal_id:scope.controller!=='work'?id:null};
}
module.exports={withActionScope,actionAttribution};
