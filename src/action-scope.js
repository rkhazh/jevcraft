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
 try{return await actions.run(scope,run);}finally{scope.active=false;}
}
function actionAttribution(bot){
 const scope=actions.getStore();
 if(!scope?.active||scope.bot!==bot)return {controller:'unknown',goal_id:null,interrupted_goal_id:null};
 const id=scope.intent?.owner.active?scope.intent.goal_id:null;
 return {controller:scope.controller,goal_id:scope.controller==='work'?id:null,interrupted_goal_id:scope.controller!=='work'?id:null};
}
module.exports={withActionScope,actionAttribution};
