'use strict';
// Priority is not authority: a recent hit can make preparation "pressing".
// During persona hold the body still owns care, threats and existing recovery
// obligations. Preparation remains observable, for the persona to commission.
function claimEligible(goal, claim){
 if(goal?.personaHold!==true)return true;
 return !!claim && (claim.layer==='work'||claim.layer==='vitals'||claim.reflex||claim.alert||
  claim.purpose==='response'||claim.purpose==='obligation');
}
// The survival runner enforces the same eligibility rule, including backstops.
// Holding does not tether an admitted escape or recovery to a fixed anchor.
async function idleBackgroundStep({hold=false,survive,loot,work,stopMotion}){
 if(await survive())return 'survival';
 if(hold){stopMotion();return 'hold';}
 if(await loot())return 'loot';
 await work();return 'work';
}
module.exports={idleBackgroundStep,claimEligible};
