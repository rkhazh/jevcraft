'use strict';
const {Worker}=require('node:worker_threads'),{randomUUID}=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),{Vec3}=require('vec3');
const fail=code=>{throw Object.assign(new Error(code),{code})};
const point=p=>p&&[p.x,p.y,p.z].every(Number.isFinite)?{x:p.x,y:p.y,z:p.z}:null;
function installPersonaVision(bot,{assetRoot=path.resolve(__dirname,'../../setup/jevcraft-community/vision-assets/1.21.11'),sessionId,worldId,ready,safeToLook,activeGoalId,range=24,workerFactory=()=>new Worker(path.join(__dirname,'persona-vision-worker.js'))}={}){
 let worker=null,busy=false,closed=false,last=-Infinity,lastLook=-Infinity,looking=false,generation=0;
 let assetsReady=false;try{assetsReady=JSON.parse(fs.readFileSync(path.join(assetRoot,'manifest.json'))).version==='1.21.11'}catch{}
 const available=()=>assetsReady&&bot.version==='1.21.11'&&!closed;
 const capabilities=()=>({enabled:available()&&ready(),look:available()&&ready(),max_distance:64,min_interval:5,render_range:range,width:256,height:160,style:'textured_collision_geometry'});
 const reset=()=>{generation++;worker?.terminate();worker=null;};bot.on('respawn',reset);bot.once('end',()=>{closed=true;reset();});
 async function capture(){
  if(!available()||!ready())fail('vision_unavailable');if(busy||Date.now()-last<5000)fail('vision_rate_limited');
  busy=true;last=Date.now();const revision=generation,start=Date.now(),id=randomUUID(),goalId=activeGoalId(),position=point(bot.entity?.position),yaw=bot.entity?.yaw,pitch=bot.entity?.pitch,eyeHeight=bot.entity?.eyeHeight,dimension=bot.game?.dimension;
  try{
   if(!position||![yaw,pitch,eyeHeight].every(Number.isFinite))fail('vision_pose_unavailable');
   const eye=[position.x,position.y+eyeHeight,position.z],min=eye.map(n=>Math.floor(n)-range),size=range*2+1,grid=new Int32Array(size**3),types=[null],states=new Map();
   for(let i=0;i<grid.length;i++){
    if(i%1024===0){await new Promise(resolve=>setImmediate(resolve));if(closed||revision!==generation||!ready()||bot.game?.dimension!==dimension)fail('vision_stale_session');if(Date.now()-start>1500)fail('vision_capture_timeout');}
    const x=i%size,z=Math.floor(i/size)%size,y=Math.floor(i/(size*size)),b=bot.blockAt(new Vec3(min[0]+x,min[1]+y,min[2]+z));
    if(!b){grid[i]=-1;continue;}if(!b.shapes?.length){grid[i]=0;continue;}
    const state=b.stateId??b.name;let index=states.get(state);
    if(index===undefined){if(types.length>=4096)fail('vision_palette_limit');index=types.length;states.set(state,index);types.push({name:b.name,properties:b.getProperties?.()||{},shapes:b.shapes.slice(0,32).map(s=>s.slice(0,6))});}grid[i]=index;
   }
   const checkPose=()=>{const now=point(bot.entity.position);if(!now||Math.hypot(now.x-position.x,now.y-position.y,now.z-position.z)>.25||Math.abs(bot.entity.yaw-yaw)>.03||Math.abs(bot.entity.pitch-pitch)>.03)fail('vision_camera_moved');if(activeGoalId()!==goalId)fail('vision_goal_changed');};
   checkPose();
   const sampledAt=Date.now();
   worker ||= workerFactory();
   const currentWorker=worker,result=await new Promise((resolve,reject)=>{
    const cleanup=()=>{clearTimeout(timer);currentWorker.removeListener('message',message);currentWorker.removeListener('error',error);currentWorker.removeListener('exit',exit)};
    const error=()=>{cleanup();if(worker===currentWorker)worker=null;currentWorker.terminate();reject(Object.assign(new Error('vision_render_failed'),{code:'vision_render_failed'}))};const exit=()=>error();
    const message=data=>{if(data.id!==id)return;cleanup();data.error?reject(Object.assign(new Error(data.error),{code:data.error})):resolve(data)};
    const timer=setTimeout(()=>{error();reset()},5000);currentWorker.on('message',message);currentWorker.once('error',error);currentWorker.once('exit',exit);
    currentWorker.postMessage({id,width:256,height:160,range,eye,yaw,pitch,fov:60,min,size,types,grid:grid.buffer,assetRoot},[grid.buffer]);
   });
   if(closed||revision!==generation||!ready()||bot.game?.dimension!==dimension)fail('vision_stale_session');
   checkPose();
   const png=Buffer.from(result.png);if(png.length>2*1024*1024)fail('vision_image_too_large');
   return {capture_id:id,session_id:sessionId(),world_id:worldId,active_goal_id:goalId,observed_at:start/1000,captured_at:Date.now()/1000,snapshot_duration_ms:sampledAt-start,snapshot_started_at:start/1000,snapshot_finished_at:sampledAt/1000,render_duration_ms:Date.now()-sampledAt,dimension,position,eye_position:{x:eye[0],y:eye[1],z:eye[2]},yaw,pitch,fov:60,fov_axis:'vertical',range,width:256,height:160,mime_type:'image/png',image_base64:png.toString('base64'),renderer:'cpu_textured_collision_geometry_v1',unknown_pixels:result.unknownPixels,missing_texture_pixels:result.missingTexturePixels,missing_texture_material_count:result.missingTextureMaterialCount,missing_texture_materials:result.missingTextureMaterials,limitations:['Simplified bot-eye block collision geometry, not a vanilla screenshot','No entities, non-colliding plants or fluids; server resource packs not applied','Lighting, biome tint, texture orientation and animated textures simplified','Magenta marks missing asset textures, not the real material colour; missing_texture fields quantify visible loss','Unloaded cells are opaque gray-purple; empty distance horizon is not evidence of empty terrain']};
  }finally{busy=false;}
 }
 async function look(target){
  if(!available()||!ready())fail('vision_unavailable');const p=point(target),here=point(bot.entity?.position);
  if(!p||Object.keys(target).sort().join()!=='x,y,z'||!here||Math.hypot(p.x-here.x,p.y-here.y,p.z-here.z)>64)fail('invalid_look_target');
  if(!safeToLook()||busy||looking||Date.now()-lastLook<5000)fail('look_busy');if(!bot.blockAt(new Vec3(Math.floor(p.x),Math.floor(p.y),Math.floor(p.z))))fail('look_target_unloaded');
  const revision=generation;looking=true;lastLook=Date.now();try{await bot.lookAt(new Vec3(p.x,p.y,p.z),true);if(closed||revision!==generation||!ready())fail('vision_stale_session');return {status:'looked',session_id:sessionId(),position:point(bot.entity.position),yaw:bot.entity.yaw,pitch:bot.entity.pitch};}finally{looking=false;}
 }
 return {capture,look,capabilities};
}
module.exports={installPersonaVision};
