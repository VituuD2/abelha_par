require('./setup.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSupabaseFetch } = require('../src/lib/supabase/request.ts');
const { readSupabaseUser, AuthenticationUnavailableError } = require('../src/lib/supabase/auth-user.ts');
const auth = require('../src/lib/auth.ts');
const access = require('../src/lib/access.ts');

test('slow successful Supabase calls are observable without logging credentials, queries or payloads', async t => {
  const messages = []; let clock = 0;
  t.mock.method(Date, 'now', () => clock);
  t.mock.method(console, 'warn', message => messages.push(JSON.parse(message)));
  t.mock.method(global, 'fetch', async (_input, options) => {
    assert.equal(options.headers.Authorization, 'Bearer PRIVATE_TOKEN');
    assert.ok(options.signal); clock += 13_585;
    return Response.json({ private: 'PRIVATE_PAYLOAD' }, { headers: { 'sb-request-id': 'trace-id' } });
  });
  const response = await createSupabaseFetch(20_000)('https://example.test/auth/v1/user?secret=PRIVATE_QUERY', {
    headers: { Authorization: 'Bearer PRIVATE_TOKEN' },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(messages, [{ event: 'supabase_request', path: '/auth/v1/user', method: 'GET',
    status: 200, elapsedMs: 13_585, aborted: false, requestId: 'trace-id' }]);
  assert.doesNotMatch(JSON.stringify(messages), /PRIVATE/);
});

test('Supabase fetch aborts a stalled request and preserves cancellation supplied by the caller', async t => {
  t.mock.method(console, 'warn', () => {});
  let signal;
  t.mock.method(global, 'fetch', (_input, options) => new Promise((resolve, reject) => {
    signal = options.signal;
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
  // AbortSignal.timeout uses an unreferenced timer, so keep the test alive explicitly.
  const keepAlive = setTimeout(() => {}, 1000); t.after(() => clearTimeout(keepAlive));
  await assert.rejects(createSupabaseFetch(10)('https://example.test/rest/v1/workspace_members'), { name: 'AbortError' });
  assert.equal(signal.aborted, true);
  const caller = new AbortController();
  const pending = createSupabaseFetch(1000)('https://example.test/rest/v1/workspace_members', { signal: caller.signal });
  caller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});

test('the installed Supabase SDK does not retry a read after its transport deadline expires', async t => {
  const { createClient } = require('@supabase/supabase-js'); let calls = 0;
  t.mock.method(console, 'warn', () => {});
  t.mock.method(global, 'fetch', (_input, options) => new Promise((resolve, reject) => {
    calls++;
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
  }));
  const keepAlive = setTimeout(() => {}, 1000); t.after(() => clearTimeout(keepAlive));
  const db = createClient('https://example.test', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: createSupabaseFetch(10) },
  });
  const { error } = await db.from('workspace_members').select('workspace_id');
  assert.ok(error);
  assert.equal(calls, 1, 'timeout must not multiply into several 10-second attempts');
});

test('temporary Auth errors become 503 while genuinely missing or expired sessions remain unauthenticated', async () => {
  for (const status of [0, 429, 500, 503]) {
    const client = { auth: { getUser: async () => ({ data: { user: null }, error: { status } }) } };
    await assert.rejects(readSupabaseUser(client), AuthenticationUnavailableError);
  }
  for (const error of [null, { status: 400 }, { status: 401 }, { status: 403 }]) {
    assert.equal(await readSupabaseUser({ auth: { getUser: async () => ({ data: { user: null }, error }) } }), null);
  }
  const user = { id: 'verified' };
  assert.equal(await readSupabaseUser({ auth: { getUser: async () => ({ data: { user }, error: null }) } }), user);
});

test('the whole auth operation has a deadline even if SDK initialization or refresh retries are stuck', async () => {
  await assert.rejects(readSupabaseUser({ auth: { getUser: () => new Promise(() => {}) } }, 10), AuthenticationUnavailableError);
});

test('temporary Auth unavailability denies API access with 503 and does not pretend the session was logged out', async t => {
  t.mock.method(auth, 'getAuthenticatedUser', async () => { throw new AuthenticationUnavailableError(); });
  const result = await access.authorize();
  assert.equal(result.response.status, 503);
  assert.match(result.response.headers.get('cache-control'), /no-store/);
  assert.match((await result.response.json()).error, /temporariamente indisponível/);
  for (const path of ['auth/access', 'analytics/sync', 'analytics/api-usage']) {
    const response = await require(`../src/app/api/${path}/route.ts`).GET();
    assert.equal(response.status, 503, path);
    assert.equal(response.headers.get('location'), null, path);
  }
});
