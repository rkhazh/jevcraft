'use strict';
// Survival always gets its normal turn. Optional background chores require a
// persona goal; holding does not tether escape or recovery to a fixed anchor.
async function idleBackgroundStep({hold=false,survive,loot,work,stopMotion}){
 if(await survive())return 'survival';
 if(hold){stopMotion();return 'hold';}
 if(await loot())return 'loot';
 await work();return 'work';
}
module.exports={idleBackgroundStep};
