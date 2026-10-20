// Provider tests isolate HTTP behavior; distributed pacing is exercised against SQL separately.
const control = require('../src/lib/olist-api-control.ts');
module.exports = function mockOlistQuota(t, intervalMs = 2100) {
  const slots = new Map();
  t.mock.method(control, 'acquireOlistPermit', async (scope, _source, _retry, deadline = Infinity, timeout = 10000) => {
    const now = Date.now(), key = scope.connectionId || scope.workspaceId || 'unbound';
    const next = Math.max(now, slots.get(key) || 0);
    if (next + timeout > deadline) throw new control.OlistBudgetExceeded();
    slots.set(key,next+intervalMs);
    if (next > now) await new Promise(r => setTimeout(r,next-now));
    return {id:null,waitMs:next-now};
  });
  t.mock.method(control, 'recordOlistResult', async () => {});
};
