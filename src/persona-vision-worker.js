'use strict';
const fs=require('node:fs'),path=require('node:path'),{parentPort}=require('node:worker_threads'),{PNG}=require('pngjs');
const jsonCache=new Map(),textureCache=new Map();
function asset(root,kind,name){name=String(name).replace(/^minecraft:/,'');if(!/^[a-z0-9_/.-]+$/.test(name)||name.includes('..'))return null;return path.join(root,'assets/minecraft',kind,name);}
function json(root,kind,name){const p=asset(root,kind,name+'.json');if(!p)return {};if(!jsonCache.has(p)){try{jsonCache.set(p,JSON.parse(fs.readFileSync(p,'utf8')))}catch{jsonCache.set(p,{})}}return jsonCache.get(p);}
function matchesWhen(when,props,depth=0){
 if(when===undefined)return true;
 if(!when||typeof when!=='object'||Array.isArray(when)||depth>16)return false;
 return Object.entries(when).every(([key,value])=>{
  if(key==='OR'||key==='AND')return Array.isArray(value)&&value.length>0&&(key==='OR'?value.some(part=>matchesWhen(part,props,depth+1)):value.every(part=>matchesWhen(part,props,depth+1)));
  return typeof value==='string'&&value.split('|').includes(String(props[key]));
 });
}
function textures(root,type){
 const state=json(root,'blockstates',type.name),props=type.properties||{};
 let choice;
 for(const [key,value]of Object.entries(state.variants||{})){if(!key||key.split(',').every(kv=>{const [k,v]=kv.split('=');return v.split('|').includes(String(props[k]))})){choice=Array.isArray(value)?value[0]:value;break;}}
 // Collision shapes still supply geometry. Multipart blocks (panes, walls,
 // fences, etc.) need a matching model to resolve their inherited texture.
 if(!choice)for(const part of state.multipart||[]){if(matchesWhen(part.when,props)){choice=Array.isArray(part.apply)?part.apply[0]:part.apply;if(choice?.model)break;}}
 let model=choice?.model||'block/'+type.name,merged={};const seen=new Set();
 for(let i=0;i<8&&!seen.has(model);i++){seen.add(model);const m=json(root,'models',model);merged={...(m.textures||{}),...merged};if(!m.parent)break;model=m.parent;}
 const resolve=key=>{let n=merged[key];for(let i=0;i<8&&n?.startsWith('#');i++)n=merged[n.slice(1)];return n;};
 return ['side','side','bottom','top','side','side'].map((face,i)=>{const n=resolve(face)||resolve(i===2||i===3?'end':'side')||resolve('all')||resolve('texture')||resolve('particle');const p=n&&asset(root,'textures',n+'.png');if(!p)return null;if(!textureCache.has(p)){try{textureCache.set(p,PNG.sync.read(fs.readFileSync(p)))}catch{textureCache.set(p,null)}}return textureCache.get(p);});
}
function rayBox(o,d,b){let near=-Infinity,far=Infinity,face=0;for(let a=0;a<3;a++){if(Math.abs(d[a])<1e-10){if(o[a]<b[a]||o[a]>b[a+3])return null;continue;}let lo=(b[a]-o[a])/d[a],hi=(b[a+3]-o[a])/d[a],f=a*2;if(lo>hi){[lo,hi]=[hi,lo];f++;}if(lo>near){near=lo;face=f;}far=Math.min(far,hi);if(near>far)return null;}return far>=Math.max(near,0)?{t:Math.max(near,0),face}:null;}
function render(data){
 const {width,height,range,eye,yaw,pitch,min,size,types,assetRoot}=data,grid=new Int32Array(data.grid),png=new PNG({width,height});
 const tex=types.map(t=>t?textures(assetRoot,t):null),fov=data.fov*Math.PI/180,tan=Math.tan(fov/2),aspect=width/height;
 const forward=[-Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),-Math.cos(yaw)*Math.cos(pitch)],right=[Math.cos(yaw),0,-Math.sin(yaw)],up=[Math.sin(yaw)*Math.sin(pitch),Math.cos(pitch),Math.cos(yaw)*Math.sin(pitch)];
 let unknownPixels=0,missingTexturePixels=0;const missing=new Map();const read=(x,y,z)=>{x-=min[0];y-=min[1];z-=min[2];return x<0||y<0||z<0||x>=size||y>=size||z>=size?-1:grid[(y*size+z)*size+x]};
 for(let py=0;py<height;py++)for(let px=0;px<width;px++){
  const sx=(2*(px+.5)/width-1)*tan*aspect,sy=(1-2*(py+.5)/height)*tan;let d=forward.map((n,i)=>n+right[i]*sx+up[i]*sy),length=Math.hypot(...d);d=d.map(n=>n/length);
  const cell=eye.map(Math.floor),step=d.map(n=>n>=0?1:-1),delta=d.map(n=>Math.abs(1/n)),tmax=d.map((n,i)=>((cell[i]+(n>=0?1:0))-eye[i])/n);let distance=0,color=[112,142,166];
  for(let n=0;n<range*5&&distance<=range;n++){
   const id=read(...cell);if(id<0){color=[66,62,76];unknownPixels++;break;}
   if(id>0){let hit=null;for(const shape of types[id].shapes){const bounds=shape.map((v,i)=>v+cell[i%3]),h=rayBox(eye,d,bounds);if(h&&h.t<=range&&(!hit||h.t<hit.t))hit=h;}
    if(hit){const p=eye.map((v,i)=>v+d[i]*hit.t),face=hit.face,axis=Math.floor(face/2),uv=axis===1?[p[0],p[2]]:axis===0?[p[2],p[1]]:[p[0],p[1]],texture=tex[id]?.[face];
     let rgb=[180,80,180],alpha=255;if(texture){const tx=Math.floor(((uv[0]%1+1)%1)*texture.width),ty=Math.floor(((1-uv[1]%1)%1+1)%1*Math.min(texture.height,texture.width)),offset=(ty*texture.width+tx)*4;rgb=[texture.data[offset],texture.data[offset+1],texture.data[offset+2]];alpha=texture.data[offset+3];}
     const shade=([.72,.82,.55,1,.7,.86][face])*(1-.35*hit.t/range);if(alpha>=128){color=rgb.map(v=>Math.round(v*shade));if(!texture){missingTexturePixels++;missing.set(types[id].name,(missing.get(types[id].name)||0)+1);}break;}
    }
   }
   const a=tmax[0]<tmax[1]?(tmax[0]<tmax[2]?0:2):(tmax[1]<tmax[2]?1:2);distance=tmax[a];cell[a]+=step[a];tmax[a]+=delta[a];
  }
  const offset=(py*width+px)*4;png.data[offset]=color[0];png.data[offset+1]=color[1];png.data[offset+2]=color[2];png.data[offset+3]=255;
 }
 return {png:PNG.sync.write(png),unknownPixels,missingTexturePixels,missingTextureMaterialCount:missing.size,missingTextureMaterials:[...missing].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,8).map(([name,pixels])=>({name,pixels}))};
}
if(parentPort)parentPort.on('message',data=>{try{parentPort.postMessage({id:data.id,...render(data)})}catch{parentPort.postMessage({id:data.id,error:'render_failed'})}});
module.exports={render,rayBox};
