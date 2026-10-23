require("./setup.cjs");
const { test } = require("node:test"), assert = require("node:assert/strict");
const sync = require("../src/lib/analytics/sync.ts"), auth = require("../src/lib/analytics/auth.ts");
const cron = require("../src/app/api/internal/analytics-sync/route.ts");
const costSync = require("../src/lib/analytics/cost-sync.ts");
const costHistory = require("../src/lib/analytics/cost-history-sync.ts");
require('node:test').beforeEach(t => {
  t.mock.method(Date, 'now', () => 1_800_000_000_000);
  t.mock.method(sync, 'processAnalyticsWebhookBatches', async () => ({ processed: 0, pending: false }));
  t.mock.method(sync, 'processAnalyticsReconciliation', async () => ({ checked: 0, requeued: 0 }));
});

test("analytical cron rejects missing/mismatched authorization before any work", async t => {
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "test-cron-secret";
  t.after(() => { if (previous === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = previous; });
  t.mock.method(auth,"refreshDueAnalyticsTokens",()=>{ throw new Error("Must not run"); });
  for (const header of ["", "Bearer forged", "Bearer test-cron-secrex"])
    assert.equal((await cron.POST(new Request("http://localhost/api/internal/analytics-sync",{method:"POST",headers:{authorization:header}}))).status,401);
  delete process.env.CRON_SECRET;
  assert.equal((await cron.POST(new Request("http://localhost/api/internal/analytics-sync",{method:"POST"}))).status,401);
});

test("cron processes durable queues with no browser and reports renewal failures without stopping other accounts", async t => {
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "test-cron-secret";
  t.after(() => { if (previous === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = previous; });
  const calls = [];
  t.mock.method(costHistory,"processCostHistorySync",async()=>({claimed:false,processed:0}));
  t.mock.method(costSync,"processCostSync",async()=>({processed:100,pending:true}));
  t.mock.method(auth,"refreshDueAnalyticsTokens",async()=>({checked:1,reconnect:1,failed:0}));
  t.mock.method(sync,"enqueueIncremental",async()=>{calls.push("incremental");});
  t.mock.method(sync,"processAnalyticsBatches",async(workspace,budget)=>{calls.push({workspace,budget});return {processed:3,pending:true};});
  const response=await cron.POST(new Request("http://localhost/api/internal/analytics-sync",{method:"POST",headers:{authorization:"Bearer test-cron-secret"}}));
  assert.equal(response.status,503);
  const body=await response.json();
  assert.equal(body.processed,3);
  assert.equal(body.costs.processed,100);
  assert.match(body.guidance,/Reconecte.*Ninho/);
  assert.equal(calls[1].workspace,undefined);
  assert.ok(calls[1].budget<=45000);
  assert.equal(JSON.stringify(body).includes("test-cron-secret"),false);
});

test("cost worker failure does not prevent the sales workers from advancing",async t=>{
  const previous=process.env.CRON_SECRET;process.env.CRON_SECRET='cost-cron-test';
  t.after(()=>{if(previous===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=previous;});
  t.mock.method(auth,'refreshDueAnalyticsTokens',async()=>({checked:0,reconnect:0,failed:0}));
  t.mock.method(sync,'enqueueIncremental',async()=>{});
  t.mock.method(costHistory,'processCostHistorySync',async()=>({claimed:false,processed:0}));
  t.mock.method(costSync,'processCostSync',async()=>{throw Error('transient DB failure');});
  t.mock.method(sync,'processAnalyticsBatches',async()=>({processed:7,pending:false}));
  const response=await cron.POST(new Request('http://localhost/api/internal/analytics-sync',{method:'POST',headers:{authorization:'Bearer cost-cron-test'}}));
  const body=await response.json();assert.equal(response.status,503);assert.equal(body.processed,7);assert.ok(body.costs.error);
});

test('thrown renewal and scheduling failures still run the existing durable sales queues', async t => {
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'isolation-test';
  t.after(() => { if (previous === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = previous; });
  const calls = [];
  t.mock.method(auth, 'refreshDueAnalyticsTokens', async () => { calls.push('renewal'); throw Error('private database details'); });
  t.mock.method(sync, 'enqueueIncremental', async () => { calls.push('schedule'); throw Error('private database details'); });
  t.mock.method(costHistory, 'processCostHistorySync', async () => ({claimed: false, processed: 0}));
  t.mock.method(costSync, 'processCostSync', async () => ({processed: 0}));
  t.mock.method(sync, 'processAnalyticsBatches', async () => { calls.push('sales'); return {processed: 9, pending: true}; });
  const response = await cron.POST(new Request('http://localhost/api/internal/analytics-sync', {method: 'POST', headers: {authorization: 'Bearer isolation-test'}}));
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.processed, 9);
  assert.equal(body.renewal.failed, 1);
  assert.equal(body.scheduling.ok, false);
  assert.deepEqual(calls, ['renewal', 'schedule', 'sales']);
  assert.equal(JSON.stringify(body).includes('private database details'), false);
});

test('scheduled quota waits return HTTP 200 while genuine batch failures retain HTTP 503',async t=>{
  const previous=process.env.CRON_SECRET;process.env.CRON_SECRET='wait-test';
  t.after(()=>{if(previous===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=previous;});
  t.mock.method(auth,'refreshDueAnalyticsTokens',async()=>({checked:0,reconnect:0,failed:0}));
  t.mock.method(sync,'enqueueIncremental',async()=>{});t.mock.method(costHistory,'processCostHistorySync',async()=>({claimed:false,processed:0}));
  t.mock.method(costSync,'processCostSync',async()=>({processed:0}));
  for(const realFailure of [false,true]){
    t.mock.method(sync,'processAnalyticsBatches',async()=>({processed:5,pending:true,...(realFailure?{error:'Falha real.'}:{outcomes:[{outcome:'quota_wait'}]})}));
    const response=await cron.POST(new Request('http://localhost/api/internal/analytics-sync',{method:'POST',headers:{authorization:'Bearer wait-test'}}));
    assert.equal(response.status,realFailure?503:200);assert.equal((await response.json()).processed,5);
  }
});

test('two of three cron cycles leave the CMV account available for sales',async t=>{
  const previous=process.env.CRON_SECRET;process.env.CRON_SECRET='fairness-test';
  t.after(()=>{if(previous===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=previous;});
  t.mock.method(Date,'now',()=>1_800_000_060_000);
  t.mock.method(auth,'refreshDueAnalyticsTokens',async()=>({checked:0,reconnect:0,failed:0}));t.mock.method(sync,'enqueueIncremental',async()=>{});
  t.mock.method(costHistory,'processCostHistorySync',async()=>{throw Error('Cost worker should not acquire this cycle');});
  t.mock.method(sync,'processAnalyticsBatches',async()=>({processed:4,pending:true}));
  const response=await cron.POST(new Request('http://localhost/api/internal/analytics-sync',{method:'POST',headers:{authorization:'Bearer fairness-test'}}));
  assert.equal(response.status,200);assert.equal((await response.json()).processed,4);
});

test('cron drains webhooks first and gives the sweep only the remaining 45-second budget', async t => {
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'webhook-budget-test';
  t.after(() => { if (previous === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = previous; });
  let now = 1_800_000_000_000;
  const calls = [];
  t.mock.method(Date, 'now', () => now);
  t.mock.method(auth, 'refreshDueAnalyticsTokens', async () => ({ checked: 0, reconnect: 0, failed: 0 }));
  t.mock.method(sync, 'processAnalyticsWebhookBatches', async (workspace, budget) => {
    calls.push('webhooks'); assert.equal(workspace, undefined); assert.equal(budget, 20000);
    now += 20000;
    return { processed: 2, pending: false };
  });
  t.mock.method(sync, 'enqueueIncremental', async () => { calls.push('schedule'); });
  t.mock.method(costHistory, 'processCostHistorySync', async () => { throw Error('No time left for costs'); });
  t.mock.method(sync, 'processAnalyticsBatches', async (workspace, budget) => {
    calls.push('sweep'); assert.equal(workspace, undefined); assert.equal(budget, 25000);
    return { processed: 3, pending: false };
  });
  const response = await cron.POST(new Request('http://localhost/api/internal/analytics-sync', {
    method: 'POST', headers: { authorization: 'Bearer webhook-budget-test' },
  }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).processed, 5);
  assert.deepEqual(calls, ['webhooks', 'schedule', 'sweep']);
});
