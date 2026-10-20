require("./setup.cjs");
const { test } = require("node:test"),
  assert = require("node:assert/strict");
const access = require("../src/lib/access.ts"),
  admin = require("../src/lib/supabase/admin.ts");
const abc = require("../src/app/api/analytics/abc/route.ts"),
  connections = require("../src/app/api/analytics/connections/route.ts"),
  exportApi = require("../src/app/api/analytics/export/route.ts");
const { NextResponse } = require("next/server");
const compositionCatalog = require("../src/lib/analytics/data/composition-catalog.json");
const filters = {
  from: "2026-09-01",
  to: "2026-09-30",
  metric: "revenue",
  mode: "TINY_LEGACY",
  grouping: "product",
  basis: "orders",
  thresholdA: 80,
  thresholdB: 95,
  selections: {},
};
test("composition report and drilldown use the server catalog and ignore forged rules and identities", async t => {
  const calls = [];
  t.mock.method(access, "authorize", async () => ({ access: { workspaceId: compositionCatalog.workspaceIds[0], user: { id: "trusted-user" }, role: "operator" } }));
  t.mock.method(admin, "createAdminClient", () => ({ rpc: async (name,args) => { calls.push({name,args}); return {data:{rows:[],total:0},error:null}; } }));
  const requestBody={filters:{...filters,grouping:"composition"},ensureCoverage:false,workspaceId:"foreign",p_rules:{rules:{"HBCOMAX-K001S":{target:"FORGED",factor:"999"}},unlinkedRules:{"HBCOMAX-K001S":{target:"FORGED",factor:"999"}}}};
  const response=await abc.POST(new Request("http://localhost/api/analytics/abc",{method:"POST",body:JSON.stringify(requestBody)}));
  assert.equal(response.status,200);
  assert.equal(calls[0].name,"analytics_abc_components_v19");
  assert.deepEqual(calls[0].args.p_rules.referenceCosts,{});
  assert.equal(calls[0].args.p_rules.rules["HBCOMAX-K001S"].target,"HBCOMAX-K001");
  assert.equal(calls[0].args.p_rules.rules["HBCOMAX-K001S"].factor,"1");
  assert.equal(calls[0].args.p_rules.unlinkedRules["HBCOMAX-K001S"],undefined);
  assert.deepEqual(Object.keys(calls[0].args.p_rules.unlinkedRules).sort(),["2165","CMNV150-K002"]);
  assert.equal(calls[0].args.p_actor,"trusted-user");
  assert.equal(calls[0].args.p_workspace,compositionCatalog.workspaceIds[0]);
  assert.equal(calls[0].args.p_filters.costBasis,"purchase");
  const drill=require("../src/app/api/analytics/drilldown/route.ts");
  const detail=await drill.POST(new Request("http://localhost/api/analytics/drilldown",{method:"POST",body:JSON.stringify({...requestBody,entity:"composition:HBCOMAX-K001",page:2})}));
  assert.equal(detail.status,200);
  assert.equal(calls[1].name,"analytics_drilldown_components_v19");
  assert.deepEqual(calls[1].args.p_rules,calls[0].args.p_rules);
  assert.equal(calls[1].args.p_offset,50);
});

test("a catalog is never silently applied to another workspace with coincident SKUs", async t => {
  let reads=0;
  t.mock.method(access,"authorize",async()=>({access:{workspaceId:"another-workspace",user:{id:"trusted-user"},role:"admin"}}));
  t.mock.method(admin,"createAdminClient",()=>({rpc:async()=>{reads++;return{data:{},error:null};}}));
  const response=await abc.POST(new Request("http://localhost/api/analytics/abc",{method:"POST",body:JSON.stringify({filters:{...filters,grouping:"composition"},ensureCoverage:false})}));
  assert.equal(response.status,400);
  assert.match((await response.json()).error,/revisadas para este espaço/);
  assert.equal(reads,0);
});

test("missing historical cost identifies the chosen basis without claiming sync or permission failure", async t => {
  t.mock.method(access,"authorize",async()=>({access:{workspaceId:compositionCatalog.workspaceIds[0],user:{id:"trusted-user"},role:"operator"}}));
  t.mock.method(admin,"createAdminClient",()=>({rpc:async()=>({data:null,error:{message:"CMV_REQUIRED:ACFS000-K001"}})}));
  const response=await abc.POST(new Request("http://localhost/api/analytics/abc",{method:"POST",body:JSON.stringify({filters:{...filters,grouping:"composition"},ensureCoverage:false})}));
  assert.equal(response.status,422);
  assert.equal(response.headers.get('cache-control'),'no-store');
  const {error,code,costBasis,missingCostSkus}=await response.json();
  assert.equal(code,'HISTORICAL_COST_UNAVAILABLE');assert.equal(costBasis,'purchase');assert.deepEqual(missingCostSkus,['ACFS000-K001']);
  assert.match(error,/CMV unitário.*ACFS000-K001/);
  assert.match(error,/base Custo de compra/);
  assert.match(error,/métrica Quantidade/);
  assert.doesNotMatch(error,/migração|permissão|aguarde a sincronização/);
  const average=await abc.POST(new Request("http://localhost/api/analytics/abc",{method:"POST",body:JSON.stringify({filters:{...filters,grouping:"composition",costBasis:"average"},ensureCoverage:false})}));
  assert.equal(average.status,422);
  const body=await average.json();assert.equal(body.costBasis,'average');assert.match(body.error,/base Custo médio/);assert.match(body.error,/Selecione Custo de compra por vigência/);
});
const request = (body) =>
  new Request("http://localhost/api/analytics/abc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
test("anonymous and blocked analytics calls never read data; connection operations require admin", async (t) => {
  let reads = 0,
    requires = [];
  t.mock.method(admin, "createAdminClient", () => {
    reads++;
    throw new Error("must not read");
  });
  t.mock.method(access, "authorize", async (permission = "app:access") => {
    requires.push(permission);
    return {
      response: NextResponse.json({ error: "Negado" }, { status: 403 }),
    };
  });
  for (const [route, body] of [
    [abc, { filters }],
    [connections, { action: "create", workspace: "forged" }],
    [exportApi, { filters, format: "csv" }],
  ])
    assert.equal((await route.POST(request(body))).status, 403);
  assert.deepEqual(requires, ["analytics:read", "integrations:manage", "analytics:export"]);
  assert.equal(reads, 0);
});
test("report ignores forged workspace/user, validates filters and caps browser page size", async (t) => {
  const calls = [];
  t.mock.method(access, "authorize", async () => ({
    access: {
      workspaceId: "trusted-workspace",
      user: { id: "trusted-user" },
      role: "operator",
    },
  }));
  t.mock.method(admin, "createAdminClient", () => ({
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { data: { rows: [], total: 0 }, error: null };
    },
  }));
  assert.equal(
    (
      await abc.POST(
        request({
          filters,
          workspaceId: "foreign",
          user: "foreign",
          page: 1,
          size: 50,
        }),
      )
    ).status,
    200,
  );
  assert.equal(calls[0].args.p_workspace, "trusted-workspace");
  assert.equal(calls[0].args.p_actor, "trusted-user");
  assert.equal(
    (await abc.POST(request({ filters, size: 100000 }))).status,
    400,
  );
  assert.equal(calls[1].name, "analytics_ensure_coverage");
  assert.equal(calls[1].args.p_workspace, "trusted-workspace");
  assert.equal(calls[1].args.p_actor, "trusted-user");
  assert.equal(calls.length, 2);
  assert.equal(
    (await abc.POST(request({ filters: { ...filters, thresholdA: 100 } })))
      .status,
    400,
  );
  assert.equal(calls.length, 2);
});

test("a scheduling outage remains actionable while returning the report already available", async t => {
  t.mock.method(access,"authorize",async()=>({access:{workspaceId:"trusted",user:{id:"member"},role:"operator"}}));
  t.mock.method(admin,"createAdminClient",()=>({rpc:async(name)=>name==="analytics_abc"
    ? {data:{rows:[],total:0,revenue:"0"},error:null}
    : {data:null,error:{message:"sensitive database diagnostic"}}}));
  const response=await abc.POST(request({filters}));
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.revenue,"0");
  assert.match(body.sync.error,/histórico faltante.*v12/);
  assert.equal(JSON.stringify(body).includes("sensitive"),false);
});

test("background report refreshes reuse imported data without rescheduling historical coverage",async t=>{
  const calls=[];
  t.mock.method(access,"authorize",async()=>({access:{workspaceId:"trusted",user:{id:"member"},role:"operator"}}));
  t.mock.method(admin,"createAdminClient",()=>({rpc:async(name)=>{calls.push(name);return {data:{rows:[],total:0},error:null};}}));
  assert.equal((await abc.POST(request({filters,ensureCoverage:false}))).status,200);
  assert.deepEqual(calls,["analytics_abc"]);
});

test("independent coverage scheduling cannot delay report reads and retains trusted scope and timings",async t=>{
  const coverage=require('../src/app/api/analytics/coverage/route.ts');
  const calls=[];let finishCoverage;
  t.mock.method(access,'authorize',async permission=>{
    assert.equal(permission,'analytics:read');
    return {access:{workspaceId:'trusted',user:{id:'member'},role:'operator'}};
  });
  t.mock.method(admin,'createAdminClient',()=>({rpc:async(name,args)=>{
    calls.push(name);assert.equal(args.p_workspace,'trusted');assert.equal(args.p_actor,'member');
    if(name==='analytics_ensure_coverage')return new Promise(resolve=>{finishCoverage=()=>resolve({data:{scheduled:1},error:null})});
    assert.equal(name,'analytics_abc');return {data:{rows:[],total:0,revenue:'12345'},error:null};
  }}));
  const pending=coverage.POST(request({filters,workspaceId:'forged',user:'forged'}));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(typeof finishCoverage,'function');
  const response=await abc.POST(request({filters,ensureCoverage:false}));
  assert.equal(response.status,200);assert.equal((await response.json()).revenue,'12345');
  assert.match(response.headers.get('Server-Timing'),/authorize;dur=.*report;dur=.*coverage;dur=0\.0/);
  finishCoverage();const scheduled=await pending;
  assert.deepEqual(await scheduled.json(),{sync:{scheduled:1}});
  assert.match(scheduled.headers.get('Server-Timing'),/authorize;dur=.*coverage;dur=/);
  assert.deepEqual(calls,['analytics_ensure_coverage','analytics_abc']);
});

test("independent coverage validates filters, rejects unauthorized callers and exposes scheduling outages safely",async t=>{
  const coverage=require('../src/app/api/analytics/coverage/route.ts');let calls=0;
  t.mock.method(access,'authorize',async()=>({response:Response.json({error:'Negado'},{status:403})}));
  t.mock.method(admin,'createAdminClient',()=>{calls++;throw Error('must not run')});
  assert.equal((await coverage.POST(request({filters}))).status,403);assert.equal(calls,0);
  t.mock.method(access,'authorize',async()=>({access:{workspaceId:'trusted',user:{id:'member'}}}));
  for(const body of [null,{}, {filters:{...filters,from:'2027-01-01'}}])assert.equal((await coverage.POST(request(body))).status,400);
  assert.equal(calls,0);
  t.mock.method(admin,'createAdminClient',()=>({rpc:async()=>({data:null,error:{message:'sensitive diagnostic'}})}));
  const failed=await coverage.POST(request({filters}));assert.equal(failed.status,503);
  const text=await failed.text();assert.match(text,/histórico faltante/);assert.doesNotMatch(text,/sensitive/);
});

test("legacy repair derives its integration, token and CNPJ from the authorized workspace and never updates operational credentials", async t => {
  const tiny=require("../src/lib/tiny-auth.ts"), provider=require("../src/lib/analytics/olist-client.ts");
  const {encryptToken}=require("../src/lib/token-crypto.ts");
  const previous=process.env.TOKEN_ENCRYPTION_KEY;
  process.env.TOKEN_ENCRYPTION_KEY=Buffer.alloc(32,3).toString("base64");
  t.after(()=>{if(previous===undefined)delete process.env.TOKEN_ENCRYPTION_KEY;else process.env.TOKEN_ENCRYPTION_KEY=previous;});
  const encrypted=encryptToken("test-operational-token"), reads=[],calls=[];
  t.mock.method(access,"authorize",async()=>({access:{workspaceId:"trusted",user:{id:"admin"},role:"admin"}}));
  t.mock.method(tiny,"getValidTinyToken",async workspace=>{assert.equal(workspace,"trusted");return {token:"test-operational-token",status:"valid"};});
  t.mock.method(provider,"olistRequest",async(_token,connection,path)=>{assert.equal(connection,"legacy");assert.equal(path,"/info");return {cpfCnpj:"36.965.322/0001-12"};});
  t.mock.method(admin,"createAdminClient",()=>({
    from(table){const scoped=[];const chain={select(){return chain;},eq(key,value){scoped.push([key,value]);return chain;},async single(){reads.push({table,scoped});return {data:table==="analytics_connections"?{id:"legacy",company_id:"company",version:3,credential_kind:"legacy"}:{id:"operational",access_token:encrypted},error:null};}};return chain;},
    async rpc(name,args){calls.push({name,args});return {error:null};},
  }));
  const response=await connections.POST(request({action:"relink",id:"legacy",workspaceId:"foreign",integration:"forged",taxId:"13397731000164"}));
  assert.equal(response.status,200);
  assert.ok(reads.every(r=>r.scoped.some(([k,v])=>k==="workspace_id"&&v==="trusted")));
  assert.equal(calls[0].name,"analytics_relink_legacy");
  assert.equal(calls[0].args.p_integration,"operational");
  assert.equal(calls[0].args.p_tax,"36965322000112");
  assert.equal(calls[0].args.p_access_token,encrypted);
  assert.equal(calls[0].args.p_version,3);
  assert.equal(JSON.stringify(await response.json()).includes("token"),false);
});

test("manual cost refresh schedules only the authorized workspace without a provider request",async t=>{
  const calls=[];
  t.mock.method(access,'authorize',async permission=>{assert.equal(permission,'integrations:manage');return{access:{workspaceId:'trusted',user:{id:'admin'},role:'admin'}};});
  t.mock.method(admin,'createAdminClient',()=>({
    rpc:async name=>{assert.equal(name,'analytics_seed_cost_sources');return{error:null};},
    from(table){assert.equal(table,'analytics_cost_sync');const chain={
      update(patch){assert.ok(patch.next_at);return chain;},
      eq(key,value){calls.push([key,value]);return chain;},select(){return chain;},
      async maybeSingle(){return{data:{connection_id:'olist1'}};},
    };return chain;},
  }));
  const provider=require('../src/lib/analytics/olist-client.ts');
  t.mock.method(provider,'olistRequest',async()=>{throw Error('Must not query Olist');});
  const response=await connections.POST(request({action:'refresh-costs',workspaceId:'forged',connection_id:'olist2'}));
  assert.equal(response.status,200);assert.deepEqual(calls,[['workspace_id','trusted']]);
  assert.deepEqual(await response.json(),{scheduled:true});
});

test("manual checkpoint retry accepts retry/failed only, enforces management permission and preserves import progress",async t=>{
  const api=require('../src/app/api/analytics/sync/route.ts'),next=require('next/server'),calls=[],callbacks=[];
  t.mock.method(next,'after',callback=>{callbacks.push(callback);});
  t.mock.method(access,'authorize',async permission=>{assert.equal(permission,'analytics:manage');return{access:{workspaceId:'trusted',user:{id:'admin'}}};});
  t.mock.method(admin,'createAdminClient',()=>({from(table){assert.equal(table,'analytics_sync_jobs');const chain={
    update(patch){calls.push({patch});return chain;},eq(key,value){calls.push({eq:[key,value]});return chain;},
    in(key,value){calls.push({in:[key,value]});return chain;},is(key,value){calls.push({is:[key,value]});return chain;},
    select(){return chain;},async single(){return{data:{id:'checkpoint'},error:null};},
  };return chain;}}));
  const response=await api.POST(request({action:'retry',job:'checkpoint',workspaceId:'foreign',processed:0,pending_index:0}));
  assert.equal(response.status,202);assert.equal(callbacks.length,1);
  assert.ok(calls.some(c=>c.eq?.[0]==='workspace_id'&&c.eq[1]==='trusted'));
  assert.ok(calls.some(c=>c.is?.[0]==='error_code'&&c.is[1]===null));
  assert.deepEqual(calls.find(c=>c.in).in,['status',['failed','retry']]);
  const patch=calls.find(c=>c.patch).patch;
  for(const field of ['processed','pending_index','pending_ids','cursor_date','page_offset','pages','from_date','to_date'])assert.equal(field in patch,false);
  t.mock.method(access,'authorize',async()=>({response:Response.json({error:'Negado'},{status:403})}));
  const before=calls.length;assert.equal((await api.POST(request({action:'retry',job:'checkpoint'}))).status,403);assert.equal(calls.length,before);
});
