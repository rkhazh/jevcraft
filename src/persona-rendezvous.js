'use strict';
function validateRendezvous(value){
 if(value==null)return null;
 const p=value.position;
 if(!value||typeof value.target!=='string'||!/^\w{1,16}$/.test(value.target)||value.dimension!=='overworld'||!p||![p.x,p.y,p.z].every(Number.isFinite)||Math.abs(p.x)>29999984||Math.abs(p.z)>29999984||p.y< -64||p.y>319)throw new Error('Invalid operator rendezvous configuration');
 return {target:value.target,position:{x:p.x,y:p.y,z:p.z},dimension:'overworld'};
}
module.exports={validateRendezvous};
