'use strict';
// A remembered choice is a bounded commitment, not a permanent survival rule.
// Reassessment keeps all existing danger checks and lets Jev choose stay again.
const SEAL_HOLD_MS=3*60000;
function withinSealHold(plan,now=Date.now()) {
 return Number.isFinite(plan?.at)&&Number.isFinite(now)&&now>=plan.at&&now-plan.at<SEAL_HOLD_MS;
}
module.exports={withinSealHold};
