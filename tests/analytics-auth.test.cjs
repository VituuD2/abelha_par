require("./setup.cjs");
const { test } = require("node:test"),
  assert = require("node:assert/strict");
const admin = require("../src/lib/supabase/admin.ts"),
  tiny = require("../src/lib/tiny-auth.ts");
const {
  analyticsToken,
  ensureAnalyticsIdentity,
} = require("../src/lib/analytics/auth.ts");
const provider = require("../src/lib/analytics/olist-client.ts");
const { encryptToken, decryptToken } = require("../src/lib/token-crypto.ts");
function database(accounts) {
  let saves = 0,
    failSaveOnce = false;
  const db = {
    from() {
      let filters = [],
        patch,
        single = false;
      const chain = {
        select() {
          return chain;
        },
        eq(k, v) {
          filters.push((r) => r[k] === v);
          return chain;
        },
        or() {
          return chain;
        },
        abortSignal() {
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
          patch = value;
          return chain;
        },
        then(resolve) {
          const rows = accounts.filter((row) => filters.every((f) => f(row)));
          if (patch?.access_token) {
            saves++;
            if (failSaveOnce) {
              failSaveOnce = false;
              return Promise.resolve({
                data: null,
                error: { message: "timeout" },
              }).then(resolve);
            }
          }
          if (patch) rows.forEach((row) => Object.assign(row, patch));
          return Promise.resolve({
            data: single
              ? rows[0]
                ? { ...rows[0] }
                : null
              : rows.map((r) => ({ ...r })),
            error: null,
          }).then(resolve);
        },
      };
      return chain;
    },
  };
  return {
    db,
    get saves() {
      return saves;
    },
    failOnce() {
      failSaveOnce = true;
    },
  };
}
function account(id) {
  return {
    id,
    workspace_id: "workspace",
    enabled: true,
    credential_kind: "oauth",
    legacy_integration_id: null,
    client_id: "client-" + id,
    client_secret: encryptToken("secret-" + id),
    access_token: encryptToken("access-" + id),
    refresh_token: encryptToken("refresh-" + id),
    expires_at: new Date(Date.now() - 1000).toISOString(),
    refresh_expires_at: new Date(Date.now() + 86400000).toISOString(),
    version: 1,
    refresh_lock: null,
  };
}
function key(t) {
  const prior = process.env.TOKEN_ENCRYPTION_KEY;
  process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 2).toString("base64");
  t.after(() => {
    if (prior === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
    else process.env.TOKEN_ENCRYPTION_KEY = prior;
  });
}
test("additional accounts use their own client credentials and coalesce refreshes while persisting encrypted pairs", async (t) => {
  key(t);
  const a = account("a"),
    b = account("b"),
    store = database([a, b]),
    calls = [];
  t.mock.method(admin, "createAdminClient", () => store.db);
  t.mock.method(global, "fetch", async (_url, options) => {
    calls.push(options.body);
    const app = options.body.get("client_id");
    return new Response(
      JSON.stringify({
        access_token: "new-" + app,
        refresh_token: "rotated-" + app,
        expires_in: 14400,
        refresh_expires_in: 86400,
      }),
      { status: 200 },
    );
  });
  const tokens = await Promise.all(
    Array.from({ length: 8 }, () => analyticsToken("workspace", "a")),
  );
  assert.ok(tokens.every((token) => token === "new-client-a"));
  assert.equal(calls.length, 1);
  assert.equal(await analyticsToken("workspace", "b"), "new-client-b");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].get("client_secret"), "secret-a");
  assert.equal(calls[1].get("client_secret"), "secret-b");
  assert.equal(decryptToken(a.refresh_token), "rotated-client-a");
  assert.notEqual(a.access_token, "new-client-a");
  assert.equal(a.refresh_lock, null);
  assert.equal(b.refresh_lock, null);
  await assert.rejects(
    analyticsToken("foreign-workspace", "a"),
    /indisponível/,
  );
});
test("failed token persistence retries the same pair without a second OAuth exchange", async (t) => {
  key(t);
  const a = account("retry"),
    store = database([a]);
  store.failOnce();
  t.mock.method(admin, "createAdminClient", () => store.db);
  let exchanges = 0;
  t.mock.method(global, "fetch", async () => {
    exchanges++;
    return new Response(
      JSON.stringify({
        access_token: "new",
        refresh_token: "new-refresh",
        expires_in: 14400,
        refresh_expires_in: 86400,
      }),
      { status: 200 },
    );
  });
  assert.equal(await analyticsToken("workspace", "retry"), "new");
  assert.equal(exchanges, 1);
  assert.equal(store.saves, 2);
  assert.equal(decryptToken(a.access_token), "new");
});
test("legacy analytics references the existing authorization; removal never falls through to another OAuth account", async (t) => {
  const c = {
      id: "legacy",
      workspace_id: "workspace",
      enabled: true,
      credential_kind: "legacy",
      legacy_integration_id: "integration",
    },
    store = database([c]);
  t.mock.method(admin, "createAdminClient", () => store.db);
  const seen = [];
  t.mock.method(tiny, "getValidTinyToken", async (workspace) => {
    seen.push(workspace);
    return { token: "shared-token", status: "valid" };
  });
  assert.equal(await analyticsToken("workspace", "legacy"), "shared-token");
  assert.deepEqual(seen, ["workspace"]);
  c.legacy_integration_id = null;
  await assert.rejects(analyticsToken("workspace", "legacy"), /removida/);
  assert.equal(seen.length, 1);
});

test("each changed access token must identify the expected company, including a legacy reconnect", async (t) => {
  const c = {
      id: "identity",
      company_id: "company",
      workspace_id: "workspace",
      version: 1,
      enabled: true,
      verified_tax_id: null,
      verified_token_fingerprint: null,
    },
    company = {
      id: "company",
      workspace_id: "workspace",
      tax_id: "36965322000112",
    },
    store = database([c, company]);
  t.mock.method(admin, "createAdminClient", () => store.db);
  let calls = 0;
  let tax = "13397731000164";
  t.mock.method(provider, "olistRequest", async () => {
    calls++;
    return { cpfCnpj: tax };
  });
  await assert.rejects(
    ensureAnalyticsIdentity("workspace", "identity", "token-a"),
    /CNPJ/,
  );
  assert.equal(c.verified_tax_id, null);
  tax = "36.965.322/0001-12";
  await ensureAnalyticsIdentity("workspace", "identity", "token-a");
  assert.equal(c.verified_tax_id, "36965322000112");
  assert.notEqual(c.verified_token_fingerprint, "token-a");
  await ensureAnalyticsIdentity("workspace", "identity", "token-a");
  assert.equal(calls, 2);
  tax = "37201039000187";
  await assert.rejects(
    ensureAnalyticsIdentity("workspace", "identity", "token-b"),
    /CNPJ/,
  );
  assert.equal(calls, 3);
  assert.equal(c.verified_tax_id, "36965322000112");
});
