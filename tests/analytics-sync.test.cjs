require("./setup.cjs");
const { test } = require("node:test"),
  assert = require("node:assert/strict");
const admin = require("../src/lib/supabase/admin.ts"),
  auth = require("../src/lib/analytics/auth.ts"),
  provider = require("../src/lib/analytics/olist-client.ts");
const realOlistRequest = provider.olistRequest;
const { processAnalyticsBatch, processAnalyticsBatches } = require("../src/lib/analytics/sync.ts");
const { AnalyticsActionError } = require("../src/lib/analytics/sync-errors.ts");
function fixture() {
  const job = {
    id: "job",
    workspace_id: "workspace",
    connection_id: "connection",
    mode: "backfill",
    from_date: "2026-09-01",
    to_date: "2026-09-01",
    cursor_date: "2026-09-01",
    page_offset: 0,
    pending_ids: [],
    pending_index: 0,
    page_done: false,
    processed: 0,
    pages: 0,
    attempts: 0,
    lease_token: "lease",
    lease_until: "2099-01-01T00:00:00Z",
    status: "running",
  };
  const tables = {
    analytics_sync_jobs: [job],
    analytics_connections: [
      { id: "connection", workspace_id: "workspace", sync_lock: "lease" },
    ],
    analytics_products: [],
    analytics_sources: [],
  };
  const ingested = [];
  const db = {
    from(table) {
      let op = "read",
        patch,
        filters = [],
        single = false;
      const chain = {
        select() {
          return chain;
        },
        eq(k, v) {
          filters.push((r) => r[k] === v);
          return chain;
        },
        gt(k, v) {
          filters.push((r) => r[k] > v);
          return chain;
        },
        maybeSingle() {
          single = true;
          return chain;
        },
        single() {
          single = true;
          return chain;
        },
        update(value) {
          op = "update";
          patch = value;
          return chain;
        },
        upsert(value) {
          op = "upsert";
          patch = value;
          return chain;
        },
        then(resolve) {
          let rows = tables[table] || [];
          if (op === "upsert") {
            let existing = rows.find(
              (r) =>
                r.workspace_id === patch.workspace_id &&
                r.connection_id === patch.connection_id &&
                r.external_id === patch.external_id,
            );
            if (existing) Object.assign(existing, patch);
            else {
              existing = { id: "id-" + rows.length, ...patch };
              rows.push(existing);
            }
            rows = [existing];
          } else {
            rows = rows.filter((r) => filters.every((f) => f(r)));
            if (op === "update") rows.forEach((r) => Object.assign(r, patch));
          }
          return Promise.resolve({
            data: single ? rows[0] || null : rows,
            error: null,
          }).then(resolve);
        },
      };
      return chain;
    },
    async rpc(name, params) {
      if (name === "analytics_claim_job")
        return {
          data: [{ ...job, pending_ids: [...job.pending_ids] }],
          error: null,
        };
      if (name === "analytics_ingest") {
        ingested.push(params);
        return { data: "order", error: null };
      }
      throw new Error(name);
    },
  };
  return { db, job, tables, ingested };
}
const raw = (id, channel) => ({
  id,
  data: "2026-09-01",
  situacao: 1,
  valorTotalPedido: "10",
  ecommerce: { id: channel, nome: "Canal " + channel },
  cliente: { id: 1, nome: "Cliente" },
  itens: [
    {
      produto: { id: 10, sku: "SKU", descricao: "Produto" },
      quantidade: 1,
      valorUnitario: 10,
    },
  ],
});

test("the 522-order checkpoint advances past the real signed-price order without restarting the historical range",async t=>{
  const f=fixture(),evidence=require('../docs/evidencias/olist2-decimal-20261020145558/diagnostico.json');
  Object.assign(f.job,{from_date:'2026-08-01',to_date:'2026-10-02',cursor_date:'2026-08-10',pages:10,processed:522,
    pending_ids:Array.from({length:45},(_,i)=>i===43?'382643017':String(400000000+i)),pending_index:43,page_done:true,attempts:28});
  t.mock.method(admin,'createAdminClient',()=>f.db);t.mock.method(auth,'analyticsToken',async()=> 'token');t.mock.method(auth,'ensureAnalyticsIdentity',async()=>{});
  let firstPage=true;
  t.mock.method(provider,'olistRequest',async(_t,_c,path)=>{
    if(path.endsWith('/marcadores'))return{itens:[]};
    if(path.startsWith('/produtos/'))return{id:Number(path.split('/').at(-1)),descricao:'Produto'};
    if(path==='/pedidos/382643017')return structuredClone(evidence.sanitizedInput);
    if(path==='/pedidos/400000044')throw new provider.AnalyticsApiError(429,60);
    if(path.startsWith('/pedidos?')){firstPage=false;throw Error('Must resume pending IDs before listing another page');}
    throw Error(path);
  });
  const result=await processAnalyticsBatch('workspace');
  assert.equal(result.processed,1);assert.equal(f.job.processed,523);assert.equal(f.job.pending_index,44);
  assert.equal(f.job.cursor_date,'2026-08-10');assert.equal(f.job.pages,10);assert.equal(firstPage,true);
  assert.equal(f.ingested.length,1);assert.equal(f.ingested[0].p_items[2].gross_cents,'-594');
  assert.equal(f.job.status,'retry');assert.ok(f.ingested[0].p_order.quality_flags.includes('item_com_preco_negativo'));
});
test("real-world zero catalog id no longer poisons a checkpoint: all unlinked lines are ingested once and no /produtos/0 is requested", async t => {
  const f = fixture(), paths = [];
  t.mock.method(admin, "createAdminClient", () => f.db);
  t.mock.method(auth, "analyticsToken", async () => "test-token");
  t.mock.method(auth, "ensureAnalyticsIdentity", async () => {});
  t.mock.method(provider, "olistRequest", async (_t, _c, path) => {
    paths.push(path);
    if (path.startsWith("/pedidos?")) return { itens: [{ id: 1 }, { id: 2 }], paginacao: { total: 2 } };
    if (path.endsWith("/marcadores")) return { itens: [] };
    if (path.startsWith("/produtos/")) throw new Error("An unlinked line has no catalog endpoint");
    const b = raw(path.endsWith("/1") ? 1 : 2, 101);
    b.itens[0].produto.id = 0;
    b.itens.push({ ...b.itens[0] });
    return b;
  });
  const result = await processAnalyticsBatch("workspace");
  assert.equal(result.processed, 2);
  assert.equal(f.job.status, "completed");
  assert.equal(f.ingested.length, 2);
  const ids = f.ingested.flatMap(p => p.p_items.map(i => i.product_id));
  assert.equal(new Set(ids).size, 4);
  assert.equal(paths.some(p => p.startsWith("/produtos/")), false);
  assert.ok(f.ingested.every(p => p.p_order.quality_flags.includes("item_sem_vinculo_catalogo")));
});

test("a deleted catalog product (404) retains its valid scoped ID and order values without blocking history", async t => {
  const f = fixture();
  t.mock.method(admin, "createAdminClient", () => f.db);
  t.mock.method(auth, "analyticsToken", async () => "test-token");
  t.mock.method(auth, "ensureAnalyticsIdentity", async () => {});
  t.mock.method(provider, "olistRequest", async (_t, _c, path) => {
    if (path.startsWith("/pedidos?")) return { itens: [{ id: 1 }], paginacao: { total: 1 } };
    if (path.startsWith("/produtos/")) throw new provider.AnalyticsApiError(404);
    if (path.endsWith("/marcadores")) return { itens: [] };
    return raw(1, 101);
  });
  assert.equal((await processAnalyticsBatch("workspace")).processed, 1);
  assert.equal(f.job.status, "completed");
  assert.equal(f.ingested[0].p_items[0].product_id, "10");
  assert.equal(f.ingested[0].p_items[0].gross_cents, "1000");
  assert.ok(f.ingested[0].p_order.quality_flags.includes("produto_sem_enriquecimento"));
});

test("recent denied enrichment check prevents repeating the catalog request even when an older enriched snapshot exists", async t => {
  const f=fixture();
  f.tables.analytics_products.push({workspace_id:"workspace",connection_id:"connection",external_id:"10",name:"Snapshot real",sku:"SKU",enriched_at:"2020-01-01T00:00:00Z",enrichment_checked_at:"2099-01-01T00:00:00Z"});
  t.mock.method(admin,"createAdminClient",()=>f.db);
  t.mock.method(auth,"analyticsToken",async()=>"test-token");
  t.mock.method(auth,"ensureAnalyticsIdentity",async()=>{});
  t.mock.method(provider,"olistRequest",async(_t,_c,path)=>{
    if(path.startsWith("/pedidos?"))return {itens:[{id:1}],paginacao:{total:1}};
    if(path.endsWith("/marcadores"))return {itens:[]};
    assert.ok(!path.startsWith("/produtos/"));return raw(1,101);
  });
  assert.equal((await processAnalyticsBatch("workspace")).processed,1);
});

test("required Olist calls distinguish 401/403 from retryable 429/5xx and preserve the pending order", async t => {
  for (const [http,status,code] of [[401,"failed","authorization_required"],[403,"failed","permission_required"],[429,"retry",null],[503,"retry",null]]) {
    const f=fixture();
    t.mock.method(admin,"createAdminClient",()=>f.db);
    t.mock.method(auth,"analyticsToken",async()=>"test-token");
    t.mock.method(auth,"ensureAnalyticsIdentity",async()=>{});
    t.mock.method(provider,"olistRequest",async(_t,_c,path)=>{
      if(path.startsWith("/pedidos?"))return {itens:[{id:1}],paginacao:{total:1}};
      throw new provider.AnalyticsApiError(http,60);
    });
    await processAnalyticsBatch("workspace");
    assert.equal(f.job.status,status);assert.equal(f.job.error_code,code);
    assert.deepEqual(f.job.pending_ids,["1"]);assert.equal(f.job.pending_index,0);
    assert.equal(f.ingested.length,0);
  }
});
test("analytics ingests all origins, persists progress, caches products and releases the original lease", async (t) => {
  t.mock.method(auth, "ensureAnalyticsIdentity", async () => {});
  const f = fixture(),
    paths = [];
  t.mock.method(admin, "createAdminClient", () => f.db);
  t.mock.method(auth, "analyticsToken", async () => "not-a-real-token");
  t.mock.method(provider, "olistRequest", async (_token, _conn, path) => {
    paths.push(path);
    if (path.startsWith("/pedidos?"))
      return { itens: [{ id: 1 }, { id: 2 }], paginacao: { total: 2 } };
    if (path === "/produtos/10")
      return { id: 10, descricao: "Produto", sku: "SKU" };
    if (path.endsWith("/marcadores")) return { itens: [{ descricao: "Marcador" }] };
    return raw(path.endsWith("/1") ? 1 : 2, path.endsWith("/1") ? 101 : 202);
  });
  const result = await processAnalyticsBatch("workspace");
  assert.equal(result.processed, 2);
  assert.equal(f.job.status, "completed");
  assert.equal(f.job.pending_ids.length, 0);
  assert.equal(f.tables.analytics_connections[0].sync_lock, null);
  assert.equal(f.tables.analytics_sources.length, 2);
  assert.equal(f.ingested.length, 2);
  assert.equal(paths.filter((p) => p === "/produtos/10").length, 1);
  assert.ok(!paths[0].includes("ecommerce"));
  assert.ok(paths[0].includes("dataInicial=2026-09-01"));
  assert.deepEqual(f.ingested[0].p_order.tags, ["Marcador"]);
});
test("rate limiting preserves pending order and schedules a retry without persisting a partial sale", async (t) => {
  t.mock.method(auth, "ensureAnalyticsIdentity", async () => {});
  const f = fixture();
  t.mock.method(admin, "createAdminClient", () => f.db);
  t.mock.method(auth, "analyticsToken", async () => "token");
  t.mock.method(provider, "olistRequest", async (_t, _c, path) => {
    if (path.startsWith("/pedidos?"))
      return { itens: [{ id: 1 }], paginacao: { total: 1 } };
    throw new provider.AnalyticsApiError(429, 60);
  });
  const before = Date.now(),
    result = await processAnalyticsBatch("workspace");
  assert.equal(result.pending, true);
  assert.equal(f.job.status, "retry");
  assert.deepEqual(f.job.pending_ids, ["1"]);
  assert.equal(f.job.pending_index, 0);
  assert.equal(f.ingested.length, 0);
  assert.ok(Date.parse(f.job.next_at) >= before + 60000);
  assert.equal(f.tables.analytics_connections[0].sync_lock, null);
});
test("an incremental job uses update date; inaccessible optional enrichment is flagged, not invented", async (t) => {
  t.mock.method(auth, "ensureAnalyticsIdentity", async () => {});
  const f = fixture();
  f.job.mode = "incremental";
  const paths = [];
  t.mock.method(admin, "createAdminClient", () => f.db);
  t.mock.method(auth, "analyticsToken", async () => "token");
  t.mock.method(provider, "olistRequest", async (_t, _c, path) => {
    paths.push(path);
    if (path.startsWith("/pedidos?"))
      return { itens: [{ id: 1 }], paginacao: { total: 1 } };
    if (path === "/pedidos/1") return { ...raw(1, 101), idNotaFiscal: 42 };
    throw new provider.AnalyticsApiError(403);
  });
  await processAnalyticsBatch("workspace");
  assert.ok(paths[0].includes("dataAtualizacao=2026-09-01"));
  assert.ok(!paths[0].includes("dataInicial"));
  assert.equal(f.ingested[0].p_order.invoice_eligible, false);
  assert.equal(f.ingested[0].p_items[0].parent_id, null);
  assert.ok(f.ingested[0].p_order.quality_flags.includes("nota_nao_validada"));
  assert.ok(
    f.ingested[0].p_order.quality_flags.includes("marcadores_indisponiveis"),
  );
  assert.equal(
    f.tables.analytics_connections[0].incremental_through,
    "2026-09-01",
  );
});

test("new incremental coverage waits for both sale and update scans to complete", async (t) => {
  const f = fixture(), paths = [];
  f.job.mode = "incremental";
  f.job.query_phase = "sales";
  f.job.covers_sales = true;
  t.mock.method(admin, "createAdminClient", () => f.db);
  t.mock.method(auth, "analyticsToken", async () => "token");
  t.mock.method(auth, "ensureAnalyticsIdentity", async () => {});
  t.mock.method(provider, "olistRequest", async (_t, _c, path) => {
    paths.push(path);
    return { itens: [], paginacao: { total: 0 } };
  });
  await processAnalyticsBatch("workspace");
  assert.equal(f.job.status, "completed");
  assert.match(paths[0], /dataInicial=2026-09-01/);
  assert.match(paths[1], /dataAtualizacao=2026-09-01/);
});

test("a worker traverses short pages and empty days within one lease instead of waiting another minute per day", async t => {
  const f=fixture(), paths=[];
  f.job.to_date="2026-09-05";
  t.mock.method(admin,"createAdminClient",()=>f.db);
  t.mock.method(auth,"analyticsToken",async()=>"token");
  t.mock.method(auth,"ensureAnalyticsIdentity",async()=>{});
  t.mock.method(provider,"olistRequest",async(_t,_c,path)=>{paths.push(path);return {itens:[],paginacao:{total:0}};});
  await processAnalyticsBatch("workspace");
  assert.equal(f.job.status,"completed");
  assert.equal(f.job.pages,5);
  assert.equal(paths.length,5);
  assert.equal(f.tables.analytics_connections[0].sync_lock,null);
});

test("parallel cron reserves distinct accounts once and starts all workers without waiting for another account's API", async t => {
  const fixtures=[fixture(),fixture(),fixture()];
  for(const [index,f] of fixtures.entries()) {
    f.job.id="job"+index; f.job.connection_id="connection"+index;
    f.tables.analytics_connections[0].id=f.job.connection_id;
  }
  const tables={};
  for(const f of fixtures) for(const [name,rows] of Object.entries(f.tables)) {
    tables[name] ||= []; tables[name].push(...rows);
  }
  const base=fixtures[0];
  Object.assign(base.tables,tables);
  const calls=[];
  const originalRpc=base.db.rpc;
  base.db.rpc=async(name,args)=>{
    calls.push(name);
    if(name==="analytics_claim_jobs") {assert.equal(args.p_limit,3);return {data:fixtures.map(f=>({...f.job})),error:null};}
    return originalRpc(name,args);
  };
  t.mock.method(admin,"createAdminClient",()=>base.db);
  const started=[];
  let release;
  const allStarted=new Promise(resolve=>{release=resolve;});
  t.mock.method(auth,"analyticsToken",async(_workspace,connection)=>{
    started.push(connection); if(started.length===3)release(); await allStarted; return "token";
  });
  t.mock.method(auth,"ensureAnalyticsIdentity",async()=>{});
  t.mock.method(provider,"olistRequest",async()=>({itens:[],paginacao:{total:0}}));
  const result=await processAnalyticsBatches("workspace");
  assert.equal(result.accounts,3);
  assert.equal(new Set(started).size,3);
  assert.equal(calls.filter(name=>name==="analytics_claim_jobs").length,1);
  assert.equal(calls.includes("analytics_claim_job"),false);
  assert.equal(result.error,undefined);
  assert.ok(fixtures.every(f=>f.job.status==="completed"));
});

test("expired authorization blocks a checkpoint with reconnection guidance; transient outages keep retrying", async (t) => {
  const f = fixture();
  f.job.attempts = 12;
  f.job.pending_ids = ["123"];
  f.job.pending_index = 0;
  t.mock.method(admin, "createAdminClient", () => f.db);
  t.mock.method(auth, "ensureAnalyticsIdentity", async () => {});
  t.mock.method(auth, "analyticsToken", async () => {
    throw new AnalyticsActionError("authorization_required", "Reconecte esta conta no Ninho.");
  });
  const result = await processAnalyticsBatch();
  assert.match(result.error, /Reconecte/);
  assert.equal(f.job.status, "failed");
  assert.equal(f.job.error_code, "authorization_required");
  assert.deepEqual(f.job.pending_ids, ["123"]);
  assert.equal(f.tables.analytics_connections[0].error_code, "authorization_required");
  f.job.lease_token = "lease";
  f.job.lease_until = "2099-01-01T00:00:00Z";
  t.mock.method(auth, "analyticsToken", async () => { throw new Error("Falha temporária."); });
  await processAnalyticsBatch();
  assert.equal(f.job.status, "retry");
  assert.equal(f.job.error_code, null);
  assert.deepEqual(f.job.pending_ids, ["123"]);
});

test('a marker 503 retries the same GET without refetching or skipping the pending sale', async t => {
  require('./olist-quota-mock.cjs')(t);
  const f = fixture(), paths = [], logs = [];
  let now = 1_800_000_000_000, markerCalls = 0;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(global, 'setTimeout', (fn, ms) => { now += ms; queueMicrotask(fn); });
  t.mock.method(console, 'info', message => logs.push(JSON.parse(message)));
  t.mock.method(admin, 'createAdminClient', () => f.db);
  t.mock.method(auth, 'analyticsToken', async () => 'private-token');
  t.mock.method(auth, 'ensureAnalyticsIdentity', async () => {});
  t.mock.method(provider, 'olistRequest', (...args) => realOlistRequest(...args));
  t.mock.method(global, 'fetch', async url => {
    const path = new URL(url).pathname.replace('/public-api/v3', ''); paths.push(path);
    if (path === '/pedidos') return Response.json({itens: [{id: 1}], paginacao: {total: 1}});
    if (path === '/pedidos/1') return Response.json(raw(1, 101));
    if (path === '/produtos/10') return Response.json({id: 10, descricao: 'Produto'});
    if (path.endsWith('/marcadores')) return ++markerCalls === 1 ? new Response(null, {status: 503}) : Response.json([]);
    throw Error(path);
  });
  const result = await processAnalyticsBatch();
  assert.equal(result.pending, false, JSON.stringify({result, logs, paths}));
  assert.equal(f.job.status, 'completed');
  assert.equal(f.ingested.length, 1);
  assert.equal(f.job.processed, 1);
  assert.equal(paths.filter(p => p === '/pedidos/1').length, 1);
  assert.equal(markerCalls, 2);
  assert.equal(logs[0].retries, 1);
  assert.equal(logs[0].transientFailures, 1);
  assert.equal(JSON.stringify(logs).includes('private-token'), false);
});

test('source cache avoids repeated writes and still persists metadata changes within the batch', async t => {
  for (const names of [['Canal', 'Canal', 'Canal'], ['Canal', 'Outro', 'Canal']]) {
    const f = fixture(); let sourceWrites = 0;
    const from = f.db.from;
    f.db.from = table => {
      const query = from(table), upsert = query.upsert;
      query.upsert = value => { if (table === 'analytics_sources') sourceWrites++; return upsert(value); };
      return query;
    };
    t.mock.method(admin, 'createAdminClient', () => f.db);
    t.mock.method(auth, 'analyticsToken', async () => 'token');
    t.mock.method(auth, 'ensureAnalyticsIdentity', async () => {});
    t.mock.method(provider, 'olistRequest', async (_token, _connection, path) => {
      if (path.startsWith('/pedidos?')) return {itens: [{id: 1}, {id: 2}, {id: 3}], paginacao: {total: 3}};
      if (path.endsWith('/marcadores')) return {itens: []};
      if (path.startsWith('/produtos/')) return {id: 10, descricao: 'Produto'};
      const index = Number(path.split('/').at(-1));
      return {...raw(index, 101), ecommerce: {id: 101, nome: names[index - 1]}};
    });
    await processAnalyticsBatch();
    assert.equal(f.job.status, 'completed');
    assert.equal(f.ingested.length, 3);
    assert.equal(sourceWrites, names.includes('Outro') ? 3 : 1);
    assert.equal(f.tables.analytics_sources[0].name, 'Canal');
  }
});

test('running out of request budget yields without marking a failure or advancing a pending sale', async t => {
  const f = fixture(); f.job.pending_ids = ['123'];
  t.mock.method(admin, 'createAdminClient', () => f.db);
  t.mock.method(auth, 'analyticsToken', async () => 'token');
  t.mock.method(auth, 'ensureAnalyticsIdentity', async () => {});
  t.mock.method(provider, 'olistRequest', async () => { throw new provider.AnalyticsBudgetExceeded(); });
  const result = await processAnalyticsBatch();
  assert.equal(result.error, null);
  assert.equal(f.job.status, 'queued');
  assert.equal(f.job.attempts, 0);
  assert.equal(f.job.pending_index, 0);
  assert.deepEqual(f.job.pending_ids, ['123']);
  assert.equal(f.ingested.length, 0);
});

test('database diagnostics preserve safe status and codes without exposing database details', () => {
  const { analyticsDatabaseError } = require('../src/lib/analytics/sync-errors.ts');
  assert.match(analyticsDatabaseError('Conexão indisponível.', {code: 'PGRST000', message: 'private details'}, 503).message, /PGRST000; HTTP 503/);
  assert.equal(analyticsDatabaseError('Falha.', {code: 'private token content'}).message, 'Falha. [banco: unavailable]');
});
