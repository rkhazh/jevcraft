'use strict';
const {Vec3}=require('vec3');
const shelter=require('./shelter');
const sides=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
const key=p=>`${p.x},${p.y},${p.z}`;
const cube=b=>shelter.solid(b)&&b.shapes?.some(s=>s.join(',')==='0,0,0,1,1,1');
const supported=(bot,p)=>sides.some(d=>bot.blockAt(p.offset(...d))?.boundingBox==='block');

// When loaded side blocks already prevent a body leaving horizontally, the
// overhead entrance closes the remaining opening. A roof with no anchor needs
// one supported shell neighbor first, not an unrelated pass round the shell.
function nextClosure(bot,origin,cells,{occupant=()=>null,excluded=new Set()}={}){
 const o=new Vec3(origin.x,origin.y,origin.z),roof=o.offset(0,2,0),skipped=[];
 const horizontal=[[1,0],[-1,0],[0,1],[0,-1]];
 const edge=horizontal.some(([x,z])=>require('./terrain').dropAt(bot,o.offset(x,0,z)));
 const constrained=!edge&&cube(bot.blockAt(o.offset(0,-1,0)))&&horizontal.every(([x,z])=>cube(bot.blockAt(o.offset(x,1,z))));
 const ordered=constrained?[...cells.filter(p=>key(p)===key(roof)),...cells.filter(p=>key(p)!==key(roof))]:cells;
 const available=[];
 for(const p of ordered){
  if(excluded.has(key(p)))continue;
  const block=bot.blockAt(p),body=occupant(bot,p);
  if(body){skipped.push({position:{...p},reason:'occupied',entity:body.name||body.username||'entity'});continue;}
  if(!block||!shelter.replaceable(block)){skipped.push({position:{...p},reason:!block?'unloaded':'not_replaceable',material:block?.name});continue;}
  available.push(p);
 }
 for(const p of available){
  if(supported(bot,p))return {cell:p,skipped};
  const dependency=available.find(q=>p.distanceTo(q)===1&&supported(bot,q));
  if(dependency)return {cell:dependency,forCell:p,skipped};
  skipped.push({position:{...p},reason:'no_supported_shell_anchor'});
 }
 return {cell:null,skipped};
}
module.exports={nextClosure};
