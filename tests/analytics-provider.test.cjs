require('./setup.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { olistRequest, AnalyticsApiError } = require('../src/lib/analytics/olist-client.ts');
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
