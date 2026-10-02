require("./setup.cjs");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const access = require("../src/lib/access.ts");
const admin = require("../src/lib/supabase/admin.ts");
const provider = require("../src/lib/analytics/olist-client.ts");
const auth = require("../src/lib/analytics/auth.ts");
const crypto = require("../src/lib/token-crypto.ts");
const callback = require("../src/app/api/analytics/oauth/callback/route.ts");
const { analyticsOAuthErrors } = require("../src/lib/analytics/oauth-errors.ts");

function setup(t, options = {}) {
  const previousKey = process.env.TOKEN_ENCRYPTION_KEY;
  process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  t.after(() => {
    if (previousKey === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
    else process.env.TOKEN_ENCRYPTION_KEY = previousKey;
  });
  const connection = {
    id: "olist-3",
    workspace_id: "trusted-workspace",
    company_id: "company-3",
    name: "Olist 3",
    credential_kind: "oauth",
    enabled: true,
    version: 7,
    client_id: "private-client-3",
    client_secret: crypto.encryptToken("do-not-log-secret"),
    access_token: null,
    refresh_token: null,
    verified_at: null,
    verified_tax_id: null,
    last_error: null,
  };
  const company = {
    id: "company-3",
    workspace_id: "trusted-workspace",
    tax_id: "37201039000187",
  };
  const { state, payload } = auth.createAnalyticsState("trusted-user", connection);
  connection.oauth_flow = payload.flow;
  connection.oauth_expires_at = new Date(payload.expires).toISOString();
  const writes = [], logs = [], tokenRequests = [];
  const db = {
    from(table) {
      const filters = [];
      let patch;
      let one = false;
      const chain = {
        select() { return chain; },
        abortSignal() { return chain; },
        eq(k, v) { filters.push(row => row[k] === v); return chain; },
        is(k, v) { filters.push(row => row[k] === v); return chain; },
        gt(k, v) { filters.push(row => row[k] > v); return chain; },
        update(value) { patch = value; return chain; },
        single() { one = true; return chain; },
        then(resolve, reject) {
          let rows = (table === "analytics_connections" ? [connection] : [company])
            .filter(row => filters.every(f => f(row)));
          if (patch?.access_token && options.saveError)
            return Promise.resolve({ data: null, error: { code: "write_failure" } }).then(resolve, reject);
          if (patch) {
            writes.push({ patch, matched: rows.length });
            rows.forEach(row => Object.assign(row, patch));
          }
          return Promise.resolve({
            data: one ? (rows[0] ? { ...rows[0] } : null) : rows.map(row => ({ ...row })),
            error: one && !rows.length ? { code: "not_found" } : null,
          }).then(resolve, reject);
        },
      };
      return chain;
    },
  };
  t.mock.method(access, "authorize", async () => ({
    access: { workspaceId: "trusted-workspace", user: { id: "trusted-user" } },
  }));
  t.mock.method(admin, "createAdminClient", () => db);
  t.mock.method(console, "warn", (...args) => logs.push(args));
  t.mock.method(global, "fetch", async (url, init) => {
    tokenRequests.push({ url, init });
    if (options.networkError) throw new Error("do-not-log-provider-details");
    return Response.json(options.tokenResponse === undefined ? {
      access_token: "do-not-log-access",
      refresh_token: "do-not-log-refresh",
      expires_in: 14400,
      refresh_expires_in: 86400,
    } : options.tokenResponse, { status: options.tokenStatus || 200 });
  });
  t.mock.method(provider, "olistRequest", async () => ({ cpfCnpj: "37.201.039/0001-87" }));
  const request = () => new Request(
    `https://abelha-par.vercel.app/api/analytics/oauth/callback?${new URLSearchParams({
      code: "do-not-log-code", state,
    })}`,
  );
  const errorCode = response => new URL(response.headers.get("location")).searchParams.get("analyticsError");
  return { connection, writes, logs, tokenRequests, request, errorCode };
}

test("OAuth saves encrypted tokens only after confirming the company and rejects replay", async t => {
  const s = setup(t);
  const response = await callback.GET(s.request());
  assert.equal(new URL(response.headers.get("location")).searchParams.get("analyticsConnected"), "1");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(s.connection.verified_tax_id, "37201039000187");
  assert.equal(s.connection.version, 8);
  assert.equal(crypto.decryptToken(s.connection.access_token), "do-not-log-access");
  assert.equal(crypto.decryptToken(s.connection.refresh_token), "do-not-log-refresh");
  assert.equal(s.tokenRequests[0].init.body.get("client_id"), "private-client-3");
  assert.equal(s.tokenRequests[0].init.body.get("client_secret"), "do-not-log-secret");
  assert.equal(s.tokenRequests[0].init.body.get("redirect_uri"), "https://abelha-par.vercel.app/api/analytics/oauth/callback");
  assert.equal(s.errorCode(await callback.GET(s.request())), "authorization");
  assert.equal(s.tokenRequests.length, 1);
});

for (const [status, code] of [[403, "account_permission"], [401, "account_authorization"], [429, "account_rate_limit"]]) {
  test(`account HTTP ${status} reports its cause without retrying or saving unverified tokens`, async t => {
    const s = setup(t);
    let lookups = 0;
    t.mock.method(provider, "olistRequest", async () => {
      lookups++;
      throw new provider.AnalyticsApiError(status);
    });
    assert.equal(s.errorCode(await callback.GET(s.request())), code);
    assert.equal(s.connection.last_error, analyticsOAuthErrors[code]);
    assert.equal(s.connection.access_token, null);
    assert.equal(s.connection.refresh_token, null);
    assert.equal(s.connection.verified_at, null);
    assert.equal(lookups, 1);
    assert.equal(s.tokenRequests.length, 1);
    const output = JSON.stringify(s.logs);
    for (const secret of ["do-not-log-secret", "do-not-log-access", "do-not-log-refresh", "do-not-log-code"])
      assert.ok(!output.includes(secret));
  });
}

test("a transient account lookup is retried with the same token without exchanging the code twice", async t => {
  const s = setup(t);
  const lookups = [];
  t.mock.method(provider, "olistRequest", async (...args) => {
    lookups.push(args);
    if (lookups.length === 1) throw new provider.AnalyticsApiError(503);
    return { cpfCnpj: "37201039000187" };
  });
  assert.equal(s.errorCode(await callback.GET(s.request())), null);
  assert.equal(lookups.length, 2);
  assert.deepEqual(lookups[0], lookups[1]);
  assert.equal(s.tokenRequests.length, 1);
  assert.equal(s.connection.verified_tax_id, "37201039000187");
});

test("an unavailable account lookup stops after one retry and records the recoverable failure", async t => {
  const s = setup(t);
  let lookups = 0;
  t.mock.method(provider, "olistRequest", async () => {
    lookups++;
    throw new provider.AnalyticsApiError(503);
  });
  assert.equal(s.errorCode(await callback.GET(s.request())), "account_unavailable");
  assert.equal(lookups, 2);
  assert.equal(s.connection.last_error, analyticsOAuthErrors.account_unavailable);
  assert.equal(s.connection.access_token, null);
});

for (const [tax, code] of [["13397731000164", "company"], [null, "account_response"]]) {
  test(`account identity ${code} never links tokens to the wrong company`, async t => {
    const s = setup(t);
    t.mock.method(provider, "olistRequest", async () => ({ cpfCnpj: tax }));
    assert.equal(s.errorCode(await callback.GET(s.request())), code);
    assert.equal(s.connection.access_token, null);
    assert.equal(s.connection.verified_tax_id, null);
  });
}

test("malformed OAuth responses, token network errors and refused exchanges have distinct errors", async t => {
  for (const [options, code] of [
    [{ tokenResponse: null }, "token_response"],
    [{ networkError: true }, "token_request"],
    [{ tokenStatus: 400 }, "exchange"],
  ]) {
    await t.test(code, async child => {
      const s = setup(child, options);
      assert.equal(s.errorCode(await callback.GET(s.request())), code);
      assert.equal(s.connection.last_error, analyticsOAuthErrors[code]);
      assert.equal(s.connection.access_token, null);
    });
  }
});

test("failed persistence returns save and leaves the authorization pending", async t => {
  const s = setup(t, { saveError: true });
  assert.equal(s.errorCode(await callback.GET(s.request())), "save");
  assert.equal(s.connection.access_token, null);
  assert.equal(s.connection.last_error, analyticsOAuthErrors.save);
});

test("a callback cannot overwrite a newer flow or mark it with a stale error", async t => {
  const s = setup(t);
  t.mock.method(provider, "olistRequest", async () => {
    s.connection.oauth_flow = "newer-flow";
    return { cpfCnpj: "37201039000187" };
  });
  assert.equal(s.errorCode(await callback.GET(s.request())), "save");
  assert.equal(s.connection.oauth_flow, "newer-flow");
  assert.equal(s.connection.access_token, null);
  assert.equal(s.connection.last_error, null);
});
