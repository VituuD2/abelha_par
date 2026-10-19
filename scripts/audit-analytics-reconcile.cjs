// GET-only reconciliation of one historical day. Never refreshes or imports.
require('../tests/setup.cjs');
require('dotenv').config({ quiet: true });
const { createClient } = require('@supabase/supabase-js');
const { decryptToken } = require('../src/lib/token-crypto.ts');
const fs = require('node:fs');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false,autoRefreshToken:false}});
const day = process.argv[2] || '2026-10-08';
if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Use YYYY-MM-DD');
// Rational decimal arithmetic independent of the application engine.
function fraction(v) { const s=String(v); if(!/^\d+(\.\d+)?$/.test(s)) throw new Error('Invalid decimal'); const [a,b='']=s.split('.'); return [BigInt(a+b),10n**BigInt(b.length)]; }
function cents(price,qty) { const [a,b]=fraction(price),[c,d]=fraction(qty); const numerator=a*c*100n, denominator=b*d; return (numerator*2n+denominator)/(denominator*2n); }
async function main() {
  if (process.argv.includes('--database-only')) {
    const file='docs/evidencias/curva-abc-2026-10-16/reconciliacao-'+day+'.json';
    const out=JSON.parse(fs.readFileSync(file,'utf8'));
    const cs=await db.from('analytics_connections').select('id,workspace_id,name');
    if(cs.error)throw new Error('Database read failed');
    for(const entry of out.companies.filter(e=>e.complete)) {
      const c=cs.data.find(c=>c.name===entry.name);
      const orders=await db.from('analytics_orders').select('id,status').eq('workspace_id',c.workspace_id).eq('connection_id',c.id).eq('sale_date',day).in('status',[1,5,6]);
      if(orders.error)throw new Error('Database orders read failed');
      const items=orders.data.length?await db.from('analytics_items').select('gross_cents').eq('workspace_id',c.workspace_id).in('order_id',orders.data.map(o=>o.id)):{data:[]};
      if(items.error)throw new Error('Database items read failed');
      entry.dbGrossMatchedCurrentEligibleCents ??= entry.dbGrossCents;
      entry.dbGrossCents=items.data.reduce((s,i)=>s+BigInt(i.gross_cents),0n).toString();
      entry.dbItems=items.data.length;
      entry.databaseEligibleOrders=orders.data.length;
      entry.differenceCents=(BigInt(entry.dbGrossCents)-BigInt(entry.sourceGrossCents)).toString();
    }
    out.databaseComparedAt=new Date().toISOString();out.comparison='Source and database independently filtered by statuses 1/5/6 on sale date; snapshot times differ; not an import';
    fs.writeFileSync(file,JSON.stringify(out,null,2));console.log(JSON.stringify(out,null,2));return;
  }
  const out={at:new Date().toISOString(),day,mode:'GET only; 2100ms between requests per account; no refresh',companies:[]};
  const {data:cs,error}=await db.from('analytics_connections').select('id,workspace_id,name,credential_kind,legacy_integration_id,access_token,expires_at');
  if(error) throw new Error('Unavailable');
  await Promise.all(cs.map(async c=>{
    const entry={name:c.name,complete:false,calls:0,sourceMs:0};out.companies.push(entry);
    let stored=c;
    if(c.credential_kind==='legacy') stored=(await db.from('tiny_integrations').select('access_token,expires_at').eq('id',c.legacy_integration_id).single()).data;
    if(!stored?.access_token||Date.parse(stored.expires_at||'')<Date.now()){entry.error='Expired/missing token; no refresh';return;}
    const token=decryptToken(stored.access_token);let lastStart=0;
    async function get(path){await new Promise(r=>setTimeout(r,Math.max(0,lastStart+2100-Date.now())));lastStart=Date.now();entry.calls++;
      const start=performance.now();const r=await fetch('https://api.tiny.com.br/public-api/v3'+path,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(10000)});entry.sourceMs+=Math.round(performance.now()-start);
      if(!r.ok)throw new Error('HTTP '+r.status);return r.json();}
    try {
      let ids=[],offset=0;
      while(true){const list=await get('/pedidos?'+new URLSearchParams({dataInicial:day,dataFinal:day,limit:'100',offset:String(offset),orderBy:'asc'}));
        if(!Array.isArray(list.itens))throw new Error('Invalid listing');ids.push(...list.itens.map(i=>String(i.id)));
        if(list.itens.length<100||offset+list.itens.length>=Number(list.paginacao?.total))break;offset+=100;}
      const orders=await db.from('analytics_orders').select('id,external_id,status').eq('workspace_id',c.workspace_id).eq('connection_id',c.id).eq('sale_date',day);
      if(orders.error)throw new Error('Database read failed');
      const local=new Map(orders.data.map(o=>[o.external_id,o]));
      let sourceGross=0n,dbGross=0n,eligible=0,sourceItems=0,dbItems=0,missing=0,itemDifferences=0,statusDifferences=0;
      for(const id of ids){const raw=await get('/pedidos/'+id);if(String(raw.id)!==id)throw new Error('Identity mismatch');
        const record=local.get(id);if(!record)missing++;if(record&&record.status!==Number(raw.situacao))statusDifferences++;
        if(![1,5,6].includes(Number(raw.situacao)))continue;eligible++;
        const read=await db.from('analytics_items').select('position,quantity,unit_price,gross_cents').eq('workspace_id',c.workspace_id).eq('order_id',record?.id||'00000000-0000-0000-0000-000000000000');
        if(read.error)throw new Error('Database items read failed');
        const items=read.data||[];
        sourceItems+=raw.itens.length;dbItems+=items.length;
        raw.itens.forEach((i,p)=>{const v=cents(i.valorUnitario,i.quantidade);sourceGross+=v;const stored=items.find(x=>x.position===p);
          if(!stored){itemDifferences++;return;}const g=BigInt(stored.gross_cents);dbGross+=g;
          const [a,b]=fraction(stored.quantity),[x,y]=fraction(i.quantidade);if(g!==v||a*y!==x*b)itemDifferences++;});
      }
      Object.assign(entry,{complete:true,sourceOrders:ids.length,distinctSourceIds:new Set(ids).size,dbOrders:local.size,eligibleOrders:eligible,sourceItems,dbItems,sourceGrossCents:sourceGross.toString(),dbGrossCents:dbGross.toString(),differenceCents:(dbGross-sourceGross).toString(),missingOrders:missing,itemDifferences,statusDifferences,
        sourceNotInDatabase:ids.filter(id=>!local.has(id)).length,databaseNotInSource:[...local.keys()].filter(id=>!ids.includes(id)).length});
      console.log(JSON.stringify(entry));
    }catch(e){entry.error=e.name==='TimeoutError'?'Timeout':e.message;console.log(JSON.stringify(entry));}
  }));
  const dir='docs/evidencias/curva-abc-2026-10-16';fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(dir+'/reconciliacao-'+day+'.json',JSON.stringify(out,null,2));
}
main().catch(()=>{console.error('Read-only reconciliation failed; no secrets emitted');process.exitCode=1;});
