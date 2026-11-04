'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{PNG}=require('pngjs'),{EventEmitter}=require('node:events'),{Vec3}=require('vec3');
const {render,rayBox}=require('../src/persona-vision-worker'),{installPersonaVision}=require('../src/persona-vision');
function scene(){const size=9,min=[-4,-4,-4],grid=new Int32Array(size**3);const set=(x,y,z,value)=>grid[((y+4)*size+z+4)*size+x+4]=value;return {set,data:{width:32,height:20,range:4,eye:[.5,.5,.5],yaw:0,pitch:0,min,size,grid:grid.buffer,fov:60,types:[null,{name:'stone',shapes:[[0,0,0,1,1,1]],properties:{}}],assetRoot:'/nonexistent'}};}
test('bot-eye orientation and depth occlusion use actual world geometry; unknown is distinct',()=>{
 const s=scene();s.set(0,0,-2,1);const front=render(s.data),turned=render({...s.data,yaw:Math.PI});assert.notDeepEqual(front.png,turned.png);
 const center=p=>{const image=PNG.sync.read(p);return [...image.data.subarray((10*32+16)*4,(10*32+16)*4+3)]};
 const before=center(front.png);s.set(0,0,-3,1);assert.deepEqual(center(render(s.data).png),before);
 s.set(0,0,-1,-1);const unknown=render(s.data);assert.ok(unknown.unknownPixels>0);assert.deepEqual(center(unknown.png),[66,62,76]);
 assert.equal(rayBox([0,2,0],[0,0,-1],[0,0,-2,1,1,-1]),null);
});
test('vision disabled without compatible local assets; look never mutates when unavailable',async()=>{
 const bot=new EventEmitter();bot.version='1.21.11';let looked=false;bot.lookAt=()=>{looked=true};
 const vision=installPersonaVision(bot,{assetRoot:'/not-present',ready:()=>true});assert.equal(vision.capabilities().enabled,false);await assert.rejects(vision.capture(),e=>e.code==='vision_unavailable');await assert.rejects(vision.look({x:1,y:1,z:1}));assert.equal(looked,false);bot.emit('end');
});
test('opt-in capture renders actual shapes in worker with stable pose and rate fence',async()=>{
 const fs=require('fs'),os=require('os'),path=require('path'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'vision-test-'));fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({version:'1.21.11'}));
 const bot=new EventEmitter();Object.assign(bot,{version:'1.21.11',entity:{position:new Vec3(0,64,0),yaw:0,pitch:0,eyeHeight:1.62},game:{dimension:'overworld'},blockAt:p=>({name:p.y<64?'stone':'air',stateId:p.y<64?1:0,shapes:p.y<64?[[0,0,0,1,1,1]]:[],getProperties:()=>({})}),lookAt:async()=>{}});
 const vision=installPersonaVision(bot,{assetRoot:dir,range:4,sessionId:()=> 'session',worldId:'test',ready:()=>true,safeToLook:()=>false,activeGoalId:()=>null});
 try{await assert.rejects(vision.look({x:1,y:65,z:1}),e=>e.code==='look_busy');const image=await vision.capture();assert.equal(image.session_id,'session');assert.equal(image.eye_position.y,65.62);assert.equal(PNG.sync.read(Buffer.from(image.image_base64,'base64')).width,256);assert.equal(image.renderer,'cpu_textured_collision_geometry_v1');await assert.rejects(vision.capture(),e=>e.code==='vision_rate_limited');}finally{bot.emit('end');fs.rmSync(dir,{recursive:true,force:true})}
});
test('camera or goal changes during worker rendering invalidate the frame',async()=>{
 const fs=require('fs'),os=require('os'),path=require('path'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'vision-fence-'));fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({version:'1.21.11'}));
 try{for(const mutation of ['pose','goal']){
  let goal='old';const bot=new EventEmitter();Object.assign(bot,{version:'1.21.11',entity:{position:new Vec3(0,64,0),yaw:0,pitch:0,eyeHeight:1.62},game:{dimension:'overworld'},blockAt:()=>({name:'air',shapes:[]})});
  const workerFactory=()=>{const w=new EventEmitter();w.terminate=()=>{};w.postMessage=data=>setImmediate(()=>{if(mutation==='pose')bot.entity.yaw=1;else goal='new';w.emit('message',{id:data.id,png:Buffer.alloc(8),unknownPixels:0})});return w};
  const vision=installPersonaVision(bot,{assetRoot:dir,range:1,sessionId:()=> 'session',worldId:'test',ready:()=>true,safeToLook:()=>true,activeGoalId:()=>goal,workerFactory});
  await assert.rejects(vision.capture(),e=>e.code===(mutation==='pose'?'vision_camera_moved':'vision_goal_changed'));bot.emit('end');
 }}finally{fs.rmSync(dir,{recursive:true,force:true})}
});
