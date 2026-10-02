require("./setup.cjs");
const { test } = require("node:test"),
  assert = require("node:assert/strict");
const access = require("../src/lib/access.ts"),
  admin = require("../src/lib/supabase/admin.ts");
const abc = require("../src/app/api/analytics/abc/route.ts"),
  connections = require("../src/app/api/analytics/connections/route.ts"),
  exportApi = require("../src/app/api/analytics/export/route.ts");
const { NextResponse } = require("next/server");
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
  t.mock.method(access, "authorize", async (adminOnly = false) => {
    requires.push(adminOnly);
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
  assert.deepEqual(requires, [false, true, false]);
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
  assert.equal(calls.length, 1);
  assert.equal(
    (await abc.POST(request({ filters: { ...filters, thresholdA: 100 } })))
      .status,
    400,
  );
  assert.equal(calls.length, 1);
});
