'use strict';
// Reserve synchronously before fetch: concurrent calls and retries share one cap.
class AttemptBudget {
  constructor(limit, { record = () => {}, onExhausted = () => {}, unlimited = false } = {}) {
    if (!Number.isSafeInteger(limit) || (limit < 1 && !(unlimited && limit === 0))) throw new Error('HTTP attempt limit must be a positive integer');
    this.limit=limit; this.used=0; this.record=record; this.onExhausted=onExhausted;
  }
  reserve() {
    if(this.limit>0&&this.used>=this.limit) {
      this.onExhausted();
      throw Object.assign(new Error('HTTP attempt budget exhausted'),{name:'AttemptBudgetExceeded',terminal:true});
    }
    // A failed audit write prevents dispatch as well.
    try { this.record({attempt:this.used+1,limit:this.limit,at:new Date().toISOString()}); }
    catch { this.onExhausted(); throw Object.assign(new Error('HTTP attempt audit unavailable'),{name:'AttemptBudgetUnavailable',terminal:true}); }
    this.used++;
  }
}
module.exports={AttemptBudget};
