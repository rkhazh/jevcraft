'use strict';
const {Vec3}=require('vec3');
const shelter=require('./shelter');
const point=p=>p&&[p.x,p.y,p.z].every(Number.isInteger);
const vec=p=>new Vec3(p.x,p.y,p.z);
const air=b=>b&&['air','cave_air','void_air'].includes(b.name);
const cube=b=>b&&shelter.buildingMaterials.has(b.name)&&b.shapes?.some(s=>s.join(',')==='0,0,0,1,1,1');
const same=(a,b)=>a.x===b.x&&a.y===b.y&&a.z===b.z;

function current(bot,state){
 const r=state.shaftRetreat;
 return r&&r.dimension===bot.game?.dimension&&point(r.entry)&&point(r.bottom)&&r.entry.x===r.bottom.x&&r.entry.z===r.bottom.z&&r.entry.y>r.bottom.y&&r.entry.y-r.bottom.y<=64?r:null;
}
function descentBlocked(bot,state){
 if(current(bot,state))return true;
 const p=bot.entity.position;
 return state.shelters?.some(s=>s.shaft&&s.dimension===bot.game.dimension&&point(s.origin)&&point(s.top)&&Math.floor(p.x)===s.origin.x&&Math.floor(p.z)===s.origin.z&&p.y<s.top.y);
}
function begin(bot,state,start,bottom){
 if(descentBlocked(bot,state)||!point(start)||!point(bottom)||start.x!==bottom.x||start.z!==bottom.z||start.y-bottom.y<2||start.y-bottom.y>12)return null;
 return state.shaftRetreat={dimension:bot.game.dimension,entry:{...start},bottom:{...bottom},phase:'descending',beganAt:Date.now(),excavationUsed:true,caps:[]};
}
function noteCap(bot,state,p,goal){
 const r=current(bot,state),b=bot.blockAt(p),laid=require('./own-blocks').laidAt(bot,p,null);
 if(!r||!cube(b)||!laid||!Number.isFinite(r.beganAt)||laid.at<r.beganAt)return false;
 r.caps=(r.caps||[]).filter(c=>!same(c.position,p));
 r.caps.push({position:{...p},name:b.name,stateId:b.stateId});r.phase='sheltered';return true;
}
function capMatches(bot,r,p){
 const b=bot.blockAt(p),receipt=(r.caps||[]).find(c=>point(c.position)&&same(c.position,p));
 return !!receipt&&cube(b)&&b.name===receipt.name&&Number.isInteger(receipt.stateId)&&b.stateId===receipt.stateId;
}
function arrived(bot,r){
 const p=bot.entity.position,e=r.entry;
 return Math.abs(p.x-e.x-.5)<.45&&Math.abs(p.z-e.z-.5)<.45&&Math.abs(p.y-e.y)<.15&&bot.entity.onGround!==false&&
  air(bot.blockAt(vec(e)))&&air(bot.blockAt(vec(e).offset(0,1,0)))&&shelter.solid(bot.blockAt(vec(e).offset(0,-1,0)));
}
function preflight(bot,state){
 const r=current(bot,state);if(!r)return {ok:false,reason:'No recorded shaft return route'};
 const p=bot.entity.position;
 if(Math.floor(p.x)!==r.entry.x||Math.floor(p.z)!==r.entry.z||p.y<r.bottom.y-.2||p.y>r.entry.y+.2)return {ok:false,reason:'The body is outside its recorded shaft'};
 if(!shelter.solid(bot.blockAt(p.floored().offset(0,-1,0))))return {ok:false,reason:'Shaft return needs observed supported footing'};
 for(let y=Math.floor(p.y)+2;y<=r.entry.y+1;y++){
  const c=new Vec3(r.entry.x,y,r.entry.z),b=bot.blockAt(c);
  if(!air(b)&&!capMatches(bot,r,c))return {ok:false,reason:`Shaft return blocked by ${b?.name||'unloaded cell'} at ${c}`};
  for(const [dx,dz]of [[1,0],[-1,0],[0,1],[0,-1]]){
   const beside=bot.blockAt(c.offset(dx,0,dz));
   if(!beside||require('./terrain').travelHazards.has(beside.name)||beside.getProperties?.().waterlogged===true)return {ok:false,reason:'Shaft return borders an unloaded cell or hazardous material'};
  }
 }
 return {ok:true,entry:{...r.entry},remaining:Math.max(0,r.entry.y-p.y)};
}
// Escape does not stop merely because the same unseen distant mob still exists.
// A fresh hit, projectile or reachable/visible close mob returns control to combat.
function urgent(bot){
 if(bot._recentHurtAt>Date.now()-2000)return true;
 if(require('./projectile-guard').incoming(bot,{reach:16}).length)return true;
 const {BOOM_ACROSS,BOOM_UP}=require('./survival'),{RANGE}=require('./combat-estimate'),{shooter}=require('./mob-policy'),p=bot.entity.position;
 return require('./danger').threats(bot,Math.max(40,...Object.values(RANGE))).some(t=>{
  const q=t.entity.position;
  if(t.entity.name==='warden'&&Math.hypot(q.x-p.x,q.z-p.z)<=BOOM_ACROSS&&Math.abs(q.y-p.y)<=BOOM_UP)return true;
  if(shooter(t.entity)&&t.visible&&t.distance<=(RANGE[t.entity.name]||15))return true;
  return t.distance<=3||(t.distance<=8&&(t.visible||(t.entity.velocity?.dot?.(p.minus(q))??0)>.05));
 });
}
async function returnStep(bot,task,state,goal,save,{dig,pillar=require('./pillar-recovery').pillarUp,report=()=>{},interrupt=()=>urgent(bot)}={}){
 const r=current(bot,state);if(!r)return false;
 r.phase='returning';save();
 if(arrived(bot,r)){
  r.phase='returned';delete r.failure;delete r.retryAfter;
  state.shelters=(state.shelters||[]).filter(s=>!s.shaft||s.dimension!==r.dimension||s.origin.x!==r.entry.x||s.origin.z!==r.entry.z||s.origin.y>=r.entry.y);
  if(state.stance?.choice==='dig_down')delete state.stance;
  if(bot._stance?.choice==='dig_down')delete bot._stance;
  delete state.pocketPlan;
  report({action:'returned_from_shaft',target:{...r.entry},position:{...bot.entity.position},supported:true,
   surface:require('./surface').surfaceObserver(bot)(bot.entity.position)});
  save();return true;
 }
 if(r.retryAfter>Date.now())return false;
 const plan=preflight(bot,state);
 if(!plan.ok){r.failure=plan.reason;r.retryAfter=Date.now()+5000;save();return false;}
 const before=bot.entity.position.y,guard=Object.create(task);
 guard.check=()=>{
  task.check();
  const p=bot.entity.position.floored();
  if(p.x!==r.entry.x||p.z!==r.entry.z){r.phase='displaced';throw Object.assign(new Error('Body left the recorded shaft column'),{name:'Blocked'});}
  if(interrupt())throw Object.assign(new Error('A new immediate threat interrupts the shaft return'),{name:'NeedsSafety'});
 };
 guard.check();
 goal.step={action:'return_from_shaft',target:{...r.entry}};
 report({action:'return_from_shaft',from:{...bot.entity.position},target:{...r.entry}});
 require('./turn').takeTurn(bot,'survival','return_from_shaft');
 try{
  await pillar(bot,guard,Math.min(r.entry.y,Math.floor(before)+4),{dig:async(b,t,p,options)=>{
   if(!capMatches(bot,r,p))throw new Error('Recorded shaft cap changed before removal');
   const receipt=r.caps.find(c=>same(c.position,p));
   return require('./structure-mutations').withMutationExpectation(bot,{operation:'dig',position:p,name:receipt.name,stateId:receipt.stateId,check:()=>{
    guard.check();
    const fresh=preflight(bot,state);
    if(!fresh.ok)throw Object.assign(new Error(fresh.reason),{name:'Blocked'});
   }},()=>dig(b,t,p,options));
  },maxBlocks:4,threats:false,opportunisticMining:false,allowDetours:false,canDig:b=>!!b?.position&&capMatches(bot,r,b.position)});
 }finally{save();}
 if(arrived(bot,r))return returnStep(bot,task,state,goal,save,{dig,pillar,report,interrupt});
 if(bot.entity.position.y<before+.5){r.failure='Shaft ascent made no verified progress';r.retryAfter=Date.now()+5000;save();}
 return false;
}
function endQuietEncounter(bot,state,now=Date.now()){
 const r=current(bot,state);
 const loaded=bot.entity?.onGround!==false&&!!bot.blockAt(bot.entity.position.floored());
 if(!r||!['returned','displaced'].includes(r.phase)||!loaded||urgent(bot)||require('./danger').threats(bot,32).length){delete bot._shaftQuiet;return false;}
 if(bot._shaftQuiet?.record!==r){bot._shaftQuiet={record:r,since:now};return false;}
 if(now-bot._shaftQuiet.since<10000)return false;
 state.shaftRetreatHistory=[...(state.shaftRetreatHistory||[]),{...r,endedAt:now}].slice(-4);
 delete state.shaftRetreat;delete bot._shaftQuiet;return true;
}
function resume(bot,state){
 const r=current(bot,state);if(!r)return false;
 if(r.phase==='descending'){r.phase='returning';return true;}
 if(r.phase==='returning'&&(Math.floor(bot.entity.position.x)!==r.entry.x||Math.floor(bot.entity.position.z)!==r.entry.z)){
  r.phase='displaced';r.failure='The body is outside the recorded escape column; other survival actions remain available';return true;
 }
 return false;
}
module.exports={current,descentBlocked,begin,noteCap,capMatches,arrived,preflight,urgent,returnStep,endQuietEncounter,resume};
