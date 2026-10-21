// Reconciles ERP creations against persisted ABC orders. Never imports, schedules,
// changes checkpoints, refreshes OAuth or saves customer/product payloads.
// ERP GETs reserve shared quota and record their normal usage telemetry.
const fs = require('node:fs');
const crypto = require('node:crypto');

function date(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) !== value) throw Error('Invalid date');
  return value;
}
function periods(from, to) {
  date(from); date(to); if (from > to) throw Error('Invalid range');
  const result = [];
  for (let month = from.slice(0, 7); month <= to.slice(0, 7);) {
    const end = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0, 12)).toISOString().slice(0, 10);
    for (let week = 1; week <= 4; week++) {
      const start = month + '-' + String((week - 1) * 7 + 1).padStart(2, '0');
      const finish = week === 4 ? end : month + '-' + String(week * 7).padStart(2, '0');
      result.push({ month, week, from: start < from ? from : start, to: finish > to ? to : finish,
        calendarFrom: start, calendarTo: finish, included: start <= to && finish >= from });
    }
    month = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1, 12)).toISOString().slice(0, 7);
  }
  return result;
}
function percent(numerator, denominator, complete) {
  if (!complete || !denominator) return null;
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || numerator < 0 || numerator > denominator) throw Error('Invalid percentage');
  // A rounded near-complete period must never appear as 100%.
  return numerator === denominator ? 100 : Math.min(99.99, Math.round(numerator / denominator * 10000) / 100);
}
function decimal(value, scale = 6) {
  const raw = String(value).trim();
  if (!/^-?\d+(\.\d+)?$/.test(raw)) throw Error('Invalid decimal');
  const negative = raw.startsWith('-'), [whole, fraction = ''] = (negative ? raw.slice(1) : raw).split('.');
  const units = BigInt(whole) * 10n ** BigInt(scale) + BigInt((fraction + '0'.repeat(scale)).slice(0, scale) || '0') + (Number(fraction[scale] || '0') >= 5 ? 1n : 0n);
  return negative ? -units : units;
}
function line(price, quantity) {
  const product = decimal(price) * decimal(quantity);
  return (product < 0n ? -1n : 1n) * (((product < 0n ? -product : product) + 5000000000n) / 10000000000n);
}
function summarize(rows, complete) {
  const active = rows.filter(r => r.sourceStatus !== 2);
  const present = active.filter(r => r.local);
  const statusEqual = present.filter(r => r.sourceStatus === r.local.status);
  const totalsComparable = present.filter(r => r.sourceTotalCents !== null);
  const totalsEqual = totalsComparable.filter(r => r.sourceTotalCents === String(r.local.total_cents));
  const consistent = active.filter(r => r.local && r.sourceStatus === r.local.status && r.sourceTotalCents !== null && r.sourceTotalCents === String(r.local.total_cents));
  const eligible = r => [1, 5, 6].includes(r.sourceStatus);
  const eligibleSource = active.filter(eligible);
  return {
    complete, sourceAll: rows.length, sourceActive: active.length, presentActive: present.length, missingActive: active.length - present.length,
    presencePercent: percent(present.length, active.length, complete),
    statusEqual: statusEqual.length, statusDifferences: rows.filter(r => r.local && r.sourceStatus !== r.local.status).length,
    statusAgreementPercent: percent(statusEqual.length, active.length, complete),
    totalsComparable: totalsComparable.length, totalDifferences: totalsComparable.length - totalsEqual.length,
    consistentActive: consistent.length, consistencyPercent: percent(consistent.length, active.length, complete),
    cancelledStillActive: rows.filter(r => r.sourceStatus === 2 && r.local && r.local.status !== 2).length,
    defaultEligibleSource: eligibleSource.length,
    defaultEligibleMissing: eligibleSource.filter(r => !r.local).length,
    defaultEligibilityDifferences: rows.filter(r => Boolean(eligible(r)) !== Boolean(r.local && [1, 5, 6].includes(r.local.status))).length,
    // This is the order total, NOT the gross item revenue used by ABC.
    sourceOrderTotalCents: active.every(r => r.sourceTotalCents !== null) ? active.reduce((s, r) => s + BigInt(r.sourceTotalCents), 0n).toString() : null,
    matchedLocalOrderTotalCents: present.reduce((s, r) => s + BigInt(r.local.total_cents), 0n).toString(),
  };
}
function selectSamples(rows, maximum) {
  return rows.filter(r => r.local && [1, 5, 6].includes(r.sourceStatus))
    .map(r => ({ row: r, rank: crypto.createHash('sha256').update(r.id).digest('hex') }))
    .sort((a, b) => a.rank.localeCompare(b.rank)).slice(0, maximum).map(r => r.row);
}
module.exports = { periods, percent, decimal, line, summarize, selectSamples };

async function main() {
  require('../tests/setup.cjs'); require('dotenv').config({ quiet: true });
  const { createClient } = require('@supabase/supabase-js');
  const { decryptToken } = require('../src/lib/token-crypto.ts');
  const { olistRequest } = require('../src/lib/analytics/olist-client.ts');
  const { saleDate } = require('../src/lib/analytics/normalize.ts');
  const workspace = require('../src/lib/analytics/data/composition-catalog.json').workspaceIds[0];
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const argument = name => process.argv.find(a => a.startsWith('--' + name + '='))?.slice(name.length + 3);
  const to = date(argument('to') || today);
  const samples = Number(argument('samples') ?? '2');
  if (!Number.isSafeInteger(samples) || samples < 0 || samples > 10) throw Error('Samples must be 0..10');
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(15000) }) },
  });
  const checked = (result, label) => { if (result.error) throw Error(label + ': ' + (result.error.code || 'unavailable')); return result.data; };
  const connections = checked(await db.from('analytics_connections').select('id,name,credential_kind,legacy_integration_id,access_token,expires_at,verified_tax_id').eq('workspace_id', workspace).eq('enabled', true).order('name'), 'connections');
  const jobs = checked(await db.from('analytics_sync_jobs').select('connection_id,mode,status,from_date,to_date,covers_sales').eq('workspace_id', workspace).order('from_date').limit(1000), 'jobs');
  const floor = jobs[0]?.from_date;
  if (!floor) throw Error('Missing configured history');
  const from = date(argument('from') || floor);
  if (from < floor || to > today) throw Error('Range outside configured history/current day');
  const windows = periods(from, to).filter(p => p.included);
  const directory = 'docs/evidencias/importacao-qualidade-periodos-' + new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  fs.mkdirSync(directory, { recursive: true });
  const output = { startedAt: new Date().toISOString(), from, to, historyFloor: floor, timezone: 'America/Sao_Paulo',
    dateBasis: 'ERP creation date; ABC uses commercial sale date or invoice date',
    importsReadOnly: true, quotaTelemetryRecorded: true, samplesPerAccountPeriod: samples, accounts: [] };
  const save = () => fs.writeFileSync(directory + '/quality.json', JSON.stringify(output, null, 2) + '\n');
  save();
  await Promise.all(connections.map(async account => {
    const entry = { name: account.name, connectionId: account.id, requests: 0, periods: [] };
    output.accounts.push(entry); save();
    let token, previous = 0;
    const interval = account.name === 'Olist 1' ? 3000 : 5000;
    async function get(path) {
      for (let attempt = 0; ; attempt++) {
        await new Promise(resolve => setTimeout(resolve, Math.max(0, previous + interval - Date.now())));
        previous = Date.now(); entry.requests++;
        try { return await olistRequest(token, account.id, path, { deadlineMs: Date.now() + 25000, source: 'orders' }); }
        catch (error) {
          const transient = error.kind === 'timeout' || error.kind === 'network' || [502, 503, 504].includes(error.status) || error.constructor.name === 'OlistControlError';
          if (!transient || attempt >= 1) throw error;
          entry.transientRetries = (entry.transientRetries || 0) + 1;
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }
    }
    try {
      const stored = account.credential_kind === 'legacy'
        ? checked(await db.from('tiny_integrations').select('access_token,expires_at').eq('workspace_id', workspace).eq('id', account.legacy_integration_id).single(), 'credential') : account;
      if (!stored.access_token || !(Date.parse(stored.expires_at || '') > Date.now())) throw Error('Stored token expired; no refresh performed');
      token = decryptToken(stored.access_token);
      if (!account.verified_tax_id || String((await get('/info')).cpfCnpj).replace(/\D/g, '') !== account.verified_tax_id) throw Error('Account identity mismatch');
    } catch (error) { entry.error = error.message; save(); return; }
    // Latest periods first: useful current results are saved even if a later ERP window fails.
    for (const window of [...windows].reverse()) {
      const result = { ...window, startedAt: new Date().toISOString(), pages: [], samples: [], rows: [] };
      entry.periods.push(result); save();
      try {
        const source = new Map(); let expected;
        for (let offset = 0; offset < 20000; offset += 100) {
          const body = await get('/pedidos?' + new URLSearchParams({ dataInicial: window.from, dataFinal: window.to, limit: '100', offset: String(offset), orderBy: 'asc' }));
          const total = Number(body.paginacao?.total);
          if (!Array.isArray(body.itens) || !Number.isSafeInteger(total) || total < 0) throw Error('Invalid pagination');
          expected ??= total;
          result.pages.push({ offset, count: body.itens.length, total, at: new Date().toISOString() });
          for (const row of body.itens) {
            const id = String(row.id), status = Number(row.situacao), creationDate = saleDate(row.dataCriacao);
            if (!/^\d+$/.test(id) || !Number.isInteger(status) || status < 0 || status > 10 || creationDate < window.from || creationDate > window.to) throw Error('Source row outside requested scope');
            if (source.has(id)) result.duplicateRows = (result.duplicateRows || 0) + 1;
            let totalCents = null; try { if (row.valor !== null && row.valor !== undefined) totalCents = decimal(row.valor, 2).toString(); } catch { /* Missing/unparseable total never counts as equal. */ }
            source.set(id, { id, sourceStatus: status, creationDate, sourceTotalCents: totalCents });
          }
          save();
          if (offset + body.itens.length >= total) break;
          if (!body.itens.length) throw Error('Incomplete empty source page');
        }
        const complete = !result.duplicateRows && source.size === expected && result.pages.every(p => p.total === expected);
        const ids = [...source.keys()];
        for (let offset = 0; offset < ids.length; offset += 100) {
          const rows = checked(await db.from('analytics_orders').select('id,external_id,status,total_cents,sale_date,invoice_date,invoice_eligible,fetched_at,quality_flags').eq('workspace_id', workspace).eq('connection_id', account.id).in('external_id', ids.slice(offset, offset + 100)), 'match orders');
          for (const row of rows) {
            const target = source.get(String(row.external_id));
            if (target.local) throw Error('Ambiguous local order identity');
            target.local = row;
          }
        }
        result.rows = [...source.values()]; result.summary = summarize(result.rows, complete);
        result.summary.saleDateDiffersFromCreation = result.rows.filter(r => r.local && r.creationDate !== r.local.sale_date).length;
        result.summary.localQualityFlags = result.rows.filter(r => r.local?.quality_flags?.length).length;
        save();
        for (const sample of selectSamples(result.rows, samples)) {
          const evidence = { id: sample.id, at: new Date().toISOString() }; result.samples.push(evidence);
          try {
            const raw = await get('/pedidos/' + sample.id);
            if (String(raw.id) !== sample.id || !Array.isArray(raw.itens)) throw Error('Invalid order detail');
            // Read local items after the source detail; concurrent sync may still change either side.
            const storedItems = checked(await db.from('analytics_items').select('position,product_id,quantity,unit_price,gross_cents').eq('workspace_id', workspace).eq('order_id', sample.local.id).order('position'), 'sample items');
            evidence.sourceStatus = Number(raw.situacao);
            evidence.statusChangedDuringAudit = evidence.sourceStatus !== sample.sourceStatus;
            evidence.listingTotalMatchesDetail = sample.sourceTotalCents !== null && raw.valorTotalPedido != null && sample.sourceTotalCents === decimal(raw.valorTotalPedido, 2).toString();
            evidence.saleDate = saleDate(raw.data || raw.dataCriacao);
            evidence.saleDateMatches = evidence.saleDate === sample.local.sale_date;
            evidence.sourceItems = raw.itens.length; evidence.localItems = storedItems.length;
            let differences = Math.abs(raw.itens.length - storedItems.length), sourceGross = 0n;
            for (let position = 0; position < raw.itens.length; position++) {
              const item = raw.itens[position], storedItem = storedItems.find(i => i.position === position);
              const gross = line(item.valorUnitario, item.quantidade); sourceGross += gross;
              const productId = item.produto?.id;
              const product = productId == null || String(productId) === '' || String(productId) === '0'
                ? `order:${sample.id}:item:${position}` : String(productId);
              if (!storedItem || product !== storedItem.product_id || decimal(item.quantidade) !== decimal(storedItem.quantity) || decimal(item.valorUnitario) !== decimal(storedItem.unit_price) || gross !== BigInt(storedItem.gross_cents)) differences++;
            }
            evidence.itemDifferences = differences;
            evidence.sourceGrossCents = sourceGross.toString();
            evidence.localGrossCents = storedItems.reduce((sum, i) => sum + BigInt(i.gross_cents), 0n).toString();
            evidence.sameItems = differences === 0;
          } catch (error) { evidence.error = error.message; }
          save();
        }
      } catch (error) { result.error = error.message; }
      result.finishedAt = new Date().toISOString(); save();
      console.log(JSON.stringify({ directory, account: entry.name, from: result.from, to: result.to, summary: result.summary, samples: result.samples.length, error: result.error }));
    }
    entry.finishedAt = new Date().toISOString(); save();
  }));
  output.finishedAt = new Date().toISOString();
  output.consolidated = windows.map(window => {
    const parts = output.accounts.map(a => a.periods.find(p => p.from === window.from && p.to === window.to));
    const complete = parts.length === connections.length && parts.every(p => p?.summary?.complete && !p.error);
    return { ...window, summary: summarize(parts.flatMap(p => p?.rows || []), complete) };
  });
  save(); console.log(JSON.stringify({ directory, finishedAt: output.finishedAt, requests: output.accounts.map(a => ({ name: a.name, requests: a.requests, error: a.error })) }));
}
if (require.main === module) main().catch(error => { console.error('Period audit: ' + error.message); process.exitCode = 1; });
