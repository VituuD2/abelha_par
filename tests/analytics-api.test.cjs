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
  assert.equal(calls[0].name,"analytics_abc_components_v16");
  assert.equal(calls[0].args.p_rules.rules["HBCOMAX-K001S"].target,"HBCOMAX-K001");
  assert.equal(calls[0].args.p_rules.rules["HBCOMAX-K001S"].factor,"1");
  assert.equal(calls[0].args.p_rules.unlinkedRules["HBCOMAX-K001S"],undefined);
  assert.deepEqual(Object.keys(calls[0].args.p_rules.unlinkedRules).sort(),["2165","CMNV150-K002"]);
  assert.equal(calls[0].args.p_actor,"trusted-user");
  assert.equal(calls[0].args.p_workspace,compositionCatalog.workspaceIds[0]);
  const drill=require("../src/app/api/analytics/drilldown/route.ts");
  const detail=await drill.POST(new Request("http://localhost/api/analytics/drilldown",{method:"POST",body:JSON.stringify({...requestBody,entity:"composition:HBCOMAX-K001",page:2})}));
  assert.equal(detail.status,200);
  assert.equal(calls[1].name,"analytics_drilldown_components_v16");
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

test("missing CMV gives an actionable value-report error instead of blaming the migration", async t => {
  t.mock.method(access,"authorize",async()=>({access:{workspaceId:compositionCatalog.workspaceIds[0],user:{id:"trusted-user"},role:"operator"}}));
  t.mock.method(admin,"createAdminClient",()=>({rpc:async()=>({data:null,error:{message:"CMV_REQUIRED:ACFS000-K001"}})}));
  const response=await abc.POST(new Request("http://localhost/api/analytics/abc",{method:"POST",body:JSON.stringify({filters:{...filters,grouping:"composition"},ensureCoverage:false})}));
  assert.equal(response.status,400);
  const {error}=await response.json();
  assert.match(error,/CMV unitário.*ACFS000-K001/);
  assert.match(error,/métrica Quantidade/);
  assert.doesNotMatch(error,/migração/);
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
