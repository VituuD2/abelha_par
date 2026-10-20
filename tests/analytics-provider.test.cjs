require('./setup.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { olistRequest, AnalyticsApiError } = require('../src/lib/analytics/olist-client.ts');
const { AnalyticsBudgetExceeded } = require('../src/lib/analytics/olist-client.ts');

function clock(t) {
  let now = 1_800_000_000_000;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(global, 'setTimeout', (fn, ms) => { now += ms; queueMicrotask(fn); });
  return () => now;
}

test('transient GET failures retry once within the deadline and keep account pacing', async t => {
  const now = clock(t), starts = [], attempts = [];
  t.mock.method(global, 'fetch', async () => {
    starts.push(now());
    return starts.length === 1 ? new Response(null, {status: 503}) : Response.json({id: 7});
  });
  assert.equal((await olistRequest('private-token', 'recover-503', '/pedidos/7', {
    deadlineMs: now() + 30000, retryTransient: true, onAttempt: a => attempts.push(a),
  })).id, 7);
  assert.equal(starts.length, 2);
  assert.ok(starts[1] - starts[0] >= 2100);
  assert.deepEqual(attempts.map(a => [a.status, a.retry]), [[503, false], [200, true]]);
  assert.equal(JSON.stringify(attempts).includes('private-token'), false);
});

test('persistent outages stop at two attempts; authorization and throttling never retry inline', async t => {
  const now = clock(t);
  for (const status of [401, 403, 429, 500, 502, 503, 504]) {
    let calls = 0;
    t.mock.method(global, 'fetch', async () => { calls++; return new Response(null, {status}); });
    await assert.rejects(olistRequest('token', 'persistent-' + status, '/pedidos', {
      deadlineMs: now() + 40000, retryTransient: true,
    }), e => e instanceof AnalyticsApiError && e.status === status);
    assert.equal(calls, [502, 503, 504].includes(status) ? 2 : 1);
  }
});

test('Retry-After is respected and a retry that cannot fit leaves the original failure for the queue', async t => {
  const now = clock(t);
  for (const value of ['5', '300', 'date']) {
    const header = value === 'date' ? new Date(now() + 300000).toUTCString() : value;
    const starts = [];
    t.mock.method(global, 'fetch', async () => {
      starts.push(now());
      return starts.length === 1 ? new Response(null, {status: 503, headers: {'Retry-After': header}}) : Response.json({ok: true});
    });
    const request = olistRequest('token', 'after-' + header, '/pedidos', {deadlineMs: now() + 25000, retryTransient: true});
    if (header === '5') { await request; assert.ok(starts[1] - starts[0] >= 5000); }
    else { await assert.rejects(request, e => e.status === 503 && e.retryAfter === 300); assert.equal(starts.length, 1); }
  }
  let calls = 0;
  t.mock.method(global, 'fetch', async () => { calls++; return new Response(null, {status: 503}); });
  await assert.rejects(olistRequest('token', 'short-retry', '/pedidos', {deadlineMs: now() + 11000, retryTransient: true}), e => e.status === 503);
  assert.equal(calls, 1);
  await assert.rejects(olistRequest('token', 'no-budget', '/pedidos', {deadlineMs: now() + 9999, retryTransient: true}), AnalyticsBudgetExceeded);
  assert.equal(calls, 1);
});

test('network and body timeouts are diagnosed separately from HTTP 503 and recover within budget', async t => {
  const now = clock(t);
  for (const kind of ['network', 'timeout', 'body-timeout']) {
    const attempts = []; let calls = 0;
    t.mock.method(global, 'fetch', async () => {
      if (++calls > 1) return Response.json({ok: true});
      if (kind === 'network') throw new TypeError('fetch failed: secret-details');
      if (kind === 'timeout') throw new DOMException('secret-details', 'TimeoutError');
      const response = Response.json({});
      response.json = async () => { throw new DOMException('secret-details', 'TimeoutError'); };
      return response;
    });
    await olistRequest('token', 'recovery-' + kind, '/pedidos', {deadlineMs: now() + 30000, retryTransient: true, onAttempt: a => attempts.push(a)});
    assert.equal(calls, 2);
    assert.equal(attempts[0].kind, kind === 'network' ? 'network' : 'timeout');
    assert.equal(JSON.stringify(attempts).includes('secret-details'), false);
  }
});
test('Olist HTTP client maps network timeouts to retry, bounds Retry-After and validates response contracts', async t => {
  let reply;
  t.mock.method(global,'fetch',async(_url,options)=>{
    assert.equal(options.headers.Authorization,'Bearer test-only-token');
    assert.ok(options.signal instanceof AbortSignal);
    if(reply instanceof Error)throw reply;
    return reply;
  });
  reply=new DOMException('Simulated request timeout','TimeoutError');
  await assert.rejects(olistRequest('test-only-token','timeout','/pedidos'),e=>e instanceof AnalyticsApiError&&e.status===503);
  reply=new Response('{}',{status:429,headers:{'Retry-After':'7200'}});
  await assert.rejects(olistRequest('test-only-token','rate','/pedidos'),e=>e.status===429&&e.retryAfter===3600);
  reply=Response.json([{descricao:'Real marker'}]);
  assert.equal((await olistRequest('test-only-token','markers','/pedidos/7/marcadores')).itens[0].descricao,'Real marker');
  reply=new Response('invalid JSON',{status:200});
  await assert.rejects(olistRequest('test-only-token','invalid','/pedidos'),/Resposta Olist inválida/);
});
