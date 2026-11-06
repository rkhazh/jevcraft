'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{PNG}=require('pngjs'),{EventEmitter}=require('node:events'),{Vec3}=require('vec3');
const {render,rayBox}=require('../src/persona-vision-worker'),{installPersonaVision}=require('../src/persona-vision');
function scene(){const size=9,min=[-4,-4,-4],grid=new Int32Array(size**3);const set=(x,y,z,value)=>grid[((y+4)*size+z+4)*size+x+4]=value;return {set,data:{width:32,height:20,range:4,eye:[.5,.5,.5],yaw:0,pitch:0,min,size,grid:grid.buffer,fov:60,types:[null,{name:'stone',shapes:[[0,0,0,1,1,1]],properties:{}}],assetRoot:'/nonexistent'}};}
test('standalone assets are selected from the explicit runtime environment',()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'tolik-assets-'));
 fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({version:'1.21.11'}));
 const previous=process.env.JEV_VISION_ASSET_ROOT;
 const bot=new EventEmitter();bot.version='1.21.11';
 try{process.env.JEV_VISION_ASSET_ROOT=dir;assert.equal(installPersonaVision(bot,{ready:()=>true}).capabilities().enabled,true);
 process.env.JEV_VISION_ASSET_ROOT='/not-present-tolik-assets';assert.equal(installPersonaVision(bot,{ready:()=>true}).capabilities().enabled,false);}
 finally{bot.emit('end');if(previous===undefined)delete process.env.JEV_VISION_ASSET_ROOT;else process.env.JEV_VISION_ASSET_ROOT=previous;fs.rmSync(dir,{recursive:true,force:true});}
});
test('known geometry with absent textures reports rendering loss separately from unloaded world',()=>{
 const s=scene();s.set(0,0,-2,1);const r=render(s.data);
 assert.equal(r.unknownPixels,0);assert.ok(r.missingTexturePixels>0);
 assert.deepEqual(r.missingTextureMaterials,[{name:'stone',pixels:r.missingTexturePixels}]);
 s.set(0,0,-1,-1);const hidden=render(s.data);
 assert.equal(hidden.missingTexturePixels,0);assert.deepEqual(hidden.missingTextureMaterials,[]);
});
test('visible missing material detail is bounded without losing the total',()=>{
 const s=scene();for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++){const id=s.data.types.length;s.data.types.push({name:'material_'+id,properties:{},shapes:[[0,0,0,1,1,1]]});s.set(x,y,-2,id);}
 const r=render(s.data);assert.equal(r.missingTextureMaterialCount,9);assert.equal(r.missingTextureMaterials.length,8);
 assert.ok(r.missingTextureMaterials.reduce((sum,row)=>sum+row.pixels,0)<r.missingTexturePixels);
});
test('multipart state conditions resolve inherited textures without pretending to render model geometry',()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),root=fs.mkdtempSync(path.join(os.tmpdir(),'vision-multipart-'));
 const put=(name,value)=>{const p=path.join(root,'assets/minecraft',name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,Buffer.isBuffer(value)?value:JSON.stringify(value));};
 try{
  put('blockstates/observed_screen.json',{multipart:[{when:{OR:[{north:'true'},{AND:[{east:'true'},{open:'false'}]}]},apply:[{model:'minecraft:block/screen_part'}]}]});
  put('models/block/screen_part.json',{parent:'minecraft:block/screen_parent',textures:{surface:'block/test_surface'}});
  put('models/block/screen_parent.json',{textures:{particle:'#surface'}});
  const texture=new PNG({width:1,height:1});texture.data.set([20,180,60,255]);put('textures/block/test_surface.png',PNG.sync.write(texture));
  const s=scene();s.data.assetRoot=root;s.data.types[1].name='observed_screen';s.set(0,0,-2,1);
  for(const props of [{north:true},{east:true,open:false}]){s.data.types[1].properties=props;const r=render(s.data);assert.equal(r.missingTexturePixels,0);assert.equal(r.unknownPixels,0);const image=PNG.sync.read(r.png),i=(10*32+16)*4;assert.ok(image.data[i+1]>image.data[i]);}
  s.data.types[1].properties={east:true,open:true};assert.ok(render(s.data).missingTexturePixels>0);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
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
 try{await assert.rejects(vision.look({x:1,y:65,z:1}),e=>e.code==='look_busy');const image=await vision.capture();assert.equal(image.session_id,'session');assert.equal(image.eye_position.y,65.62);assert.equal(PNG.sync.read(Buffer.from(image.image_base64,'base64')).width,256);assert.equal(image.renderer,'cpu_textured_collision_geometry_v1');assert.ok(image.missing_texture_pixels>0);assert.deepEqual(image.missing_texture_materials,[{name:'stone',pixels:image.missing_texture_pixels}]);assert.equal(image.missing_texture_material_count,1);await assert.rejects(vision.capture(),e=>e.code==='vision_rate_limited');}finally{bot.emit('end');fs.rmSync(dir,{recursive:true,force:true})}
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
