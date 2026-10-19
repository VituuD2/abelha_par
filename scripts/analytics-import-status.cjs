// Production READ ONLY: GET database rows, STABLE coverage RPC and Olist counts.
// Never refresh OAuth, claim work, enqueue a range, or change jobs.
require('../tests/setup.cjs');
require('dotenv').config({ quiet: true });
const fs = require('node:fs');
const { createClient } = require('@supabase/supabase-js');
const { decryptToken } = require('../src/lib/token-crypto.ts');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(20000) }) },
});
const from = process.argv.find(a => /^--from=/.test(a))?.slice(7) || '2026-08-01';
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const to = process.argv.find(a => /^--to=/.test(a))?.slice(5) || today;
const dayAfter = day => new Date(Date.parse(day + 'T12:00:00Z') + 86400000).toISOString().slice(0,10);
function daysBetween(start,end) { const days=[]; for(let d=start;d<=end;d=dayAfter(d))days.push(d);return days; }
const periods=[];
for(let d=from;d<=to;) {
  const monthEnd=new Date(Date.UTC(Number(d.slice(0,4)),Number(d.slice(5,7)),0,12)).toISOString().slice(0,10);
  const end=monthEnd<to?monthEnd:to;
  if(d<=today&&end===today&&d<today) {
    const yesterday=new Date(Date.parse(today+'T12:00:00Z')-86400000).toISOString().slice(0,10);
    periods.push({from:d,to:yesterday});periods.push({from:today,to:today});
  } else periods.push({from:d,to:end});
  d=dayAfter(end);
}
const stamp=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'medium',hour12:false}).format(new Date()).replace(/[^\d]/g,'');
const dir='docs/evidencias/importacoes-'+stamp;
fs.mkdirSync(dir,{recursive:true});
const out={startedAt:new Date().toISOString(),timezone:'America/Sao_Paulo',from,to,today,readOnly:true,outputDirectory:dir};
function save(){fs.writeFileSync(dir+'/status.json',JSON.stringify(out,null,2));}
function checked(r,label){if(r.error)throw new Error(label+': '+r.error.code);return r.data||[];}
async function snapshot() {
  const [connections,jobs,cron,count]=await Promise.all([
    db.from('analytics_connections').select('id,workspace_id,company_id,name,enabled,verified_at,last_synced_at,last_error,error_code,incremental_through').order('name'),
    db.from('analytics_sync_jobs').select('id,connection_id,mode,status,from_date,to_date,cursor_date,pending_index,page_offset,processed,pages,attempts,updated_at,next_at,last_error,error_code,covers_sales,query_phase,last_claimed_at').order('updated_at',{ascending:false}).limit(1000),
    db.from('analytics_cron_runs').select('requested_at,request_id').order('requested_at',{ascending:false}).limit(10),
    db.from('analytics_orders').select('*',{head:true,count:'exact'}),
  ]);
  return {at:new Date().toISOString(),connections:checked(connections,'connections'),jobs:checked(jobs,'jobs'),cron:checked(cron,'cron'),orderCount:count.count};
}
function covered(coverage,connection,day){return coverage.some(s=>s.connection_id===connection&&s.from_date<=day&&s.to_date>=day);}
function ranges(days){const result=[];for(const day of days){const last=result.at(-1);if(last&&dayAfter(last.to)===day)last.to=day;else result.push({from:day,to:day});}return result;}
async function main(){
  out.before=await snapshot();save();
  const companies=checked(await db.from('analytics_companies').select('id,workspace_id,name,tax_id'),'companies');
  const workspace=out.before.connections[0]?.workspace_id;
  if(out.before.connections.some(c=>c.workspace_id!==workspace))throw new Error('Select one authorized workspace before running this report');
  const members=checked(await db.from('workspace_members').select('user_id').eq('workspace_id',workspace).eq('active',true).eq('role','admin').limit(1),'member');
  out.coverage=checked(await db.rpc('analytics_coverage',{p_workspace:workspace,p_actor:members[0]?.user_id},{get:true}),'coverage');
  let after=null;const imported=[];
  while(true){
    let q=db.from('analytics_orders').select('id,connection_id,external_id,number,sale_date,status,fetched_at').eq('workspace_id',workspace).gte('sale_date',from).lte('sale_date',to).order('id').limit(1000);
    if(after)q=q.gt('id',after);
    const rows=checked(await q,'orders');imported.push(...rows);if(rows.length<1000)break;after=rows.at(-1).id;
  }
  if(new Set(imported.map(r=>r.id)).size!==imported.length)throw new Error('Duplicate rows in database export');
  out.databaseReadAt=new Date().toISOString();out.importedRows=imported.length;
  const byId=new Map(out.before.connections.map(c=>[c.id,c]));
  const orderFile=imported.map(r=>({empresa:byId.get(r.connection_id)?.name,pedido_olist:r.external_id,numero:r.number,data_venda:r.sale_date,situacao:r.status,ultima_leitura_olist:r.fetched_at})).sort((a,b)=>a.empresa.localeCompare(b.empresa)||a.data_venda.localeCompare(b.data_venda)||a.pedido_olist.localeCompare(b.pedido_olist));
  fs.writeFileSync(dir+'/pedidos-importados.json',JSON.stringify(orderFile,null,2));
  out.daily=[];out.companies=[];
  for(const c of out.before.connections){
    const local=imported.filter(r=>r.connection_id===c.id);
    for(const day of daysBetween(from,to))out.daily.push({company:c.name,connection:c.id,date:day,imported:local.filter(r=>r.sale_date===day).length,nonCancelled:local.filter(r=>r.sale_date===day&&r.status!==2).length,covered:covered(out.coverage,c.id,day)});
    out.companies.push({name:c.name,connection:c.id,imported:local.length,importedNonCancelled:local.filter(r=>r.status!==2).length,firstSale:local.map(r=>r.sale_date).sort()[0]||null,lastSale:local.map(r=>r.sale_date).sort().at(-1)||null,
      coveredRanges:ranges(out.daily.filter(r=>r.connection===c.id&&r.covered).map(r=>r.date)),uncoveredRanges:ranges(out.daily.filter(r=>r.connection===c.id&&!r.covered).map(r=>r.date)),
      source:[]});
  }
  save();
  // Four windows x total/cancelled counts per account, plus identity.
  // Five seconds between GETs; a timed-out wide window may split into smaller ones.
  await Promise.all(out.before.connections.map(async c=>{
    const entry=out.companies.find(x=>x.connection===c.id);
    const creds=checked(await db.from('analytics_connections').select('credential_kind,legacy_integration_id,access_token,expires_at').eq('workspace_id',workspace).eq('id',c.id),'credential')[0];
    let stored=creds;
    if(creds.credential_kind==='legacy')stored=checked(await db.from('tiny_integrations').select('access_token,expires_at').eq('workspace_id',workspace).eq('id',creds.legacy_integration_id),'legacy')[0];
    if(!stored?.access_token||!(Date.parse(stored.expires_at||'')>Date.now())){entry.sourceError='Token unavailable or expired; no OAuth refresh performed';save();return;}
    const token=decryptToken(stored.access_token);let started=0;
    async function get(path){
      await new Promise(r=>setTimeout(r,Math.max(0,started+5000-Date.now())));started=Date.now();
      const response=await fetch('https://api.tiny.com.br/public-api/v3'+path,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw new Error('Olist HTTP '+response.status+(response.status===429?' (count audit stopped for this account to preserve provider quota)':''));
      return response.json();
    }
    try{
      const info=await get('/info');
      if(String(info.cpfCnpj).replace(/\D/g,'')!==companies.find(co=>co.id===c.company_id)?.tax_id)throw new Error('Account identity mismatch; no further source requests');
      entry.identityConfirmed=true;
      async function countPeriod(p,depth=0){
        let b,cancelledBody;
        try{
          b=await get('/pedidos?'+new URLSearchParams({dataInicial:p.from,dataFinal:p.to,limit:'1',offset:'0',orderBy:'asc'}));
          cancelledBody=await get('/pedidos?'+new URLSearchParams({dataInicial:p.from,dataFinal:p.to,limit:'1',offset:'0',orderBy:'asc',situacao:'2'}));
        }catch(e){
          const span=daysBetween(p.from,p.to);
          if(e.name==='TimeoutError'&&span.length>1&&depth<3){
            const mid=Math.floor(span.length/2);
            entry.splitAfterTimeout=(entry.splitAfterTimeout||0)+1;save();
            await countPeriod({from:p.from,to:span[mid-1]},depth+1);
            await countPeriod({from:span[mid],to:p.to},depth+1);return;
          }
          throw e;
        }
        const total=Number(b.paginacao?.total),cancelled=Number(cancelledBody.paginacao?.total);
        if(!Number.isSafeInteger(total)||total<0||!Array.isArray(b.itens)||!Number.isSafeInteger(cancelled)||cancelled<0||cancelled>total)throw new Error('Source total missing or invalid; not inferred from page length');
        const local=imported.filter(r=>r.connection_id===c.id&&r.sale_date>=p.from&&r.sale_date<=p.to);
        const database=local.length,nonCancelled=total-cancelled,databaseNonCancelled=local.filter(r=>r.status!==2).length;
        entry.source.push({...p,observedAt:new Date().toISOString(),total,cancelled,nonCancelled,imported:database,importedNonCancelled:databaseNonCancelled,countDifference:total-database,nonCancelledDifference:nonCancelled-databaseNonCancelled,pagination:b.paginacao});save();
      }
      for(const p of periods)await countPeriod(p);
      entry.sourceTotal=entry.source.reduce((s,p)=>s+p.total,0);entry.countDifference=entry.sourceTotal-entry.imported;
      entry.sourceCancelled=entry.source.reduce((s,p)=>s+p.cancelled,0);entry.sourceNonCancelled=entry.sourceTotal-entry.sourceCancelled;entry.nonCancelledDifference=entry.sourceNonCancelled-entry.importedNonCancelled;
      console.log(JSON.stringify({company:entry.name,sourceNonCancelled:entry.sourceNonCancelled,importedNonCancelled:entry.importedNonCancelled,nonCancelledDifference:entry.nonCancelledDifference}));
    }catch(e){entry.sourceError=e.name==='TimeoutError'?'Source timeout; no further requests for this account':e.message;console.log(JSON.stringify({company:entry.name,error:entry.sourceError}));}
    save();
  }));
  out.after=await snapshot();out.finishedAt=new Date().toISOString();
  out.progress=out.before.jobs.filter(j=>j.status!=='completed').map(j=>{const next=out.after.jobs.find(n=>n.id===j.id);return {company:byId.get(j.connection_id)?.name,mode:j.mode,processedBefore:j.processed,processedAfter:next?.processed,delta:(next?.processed||0)-j.processed,cursorBefore:j.cursor_date,cursorAfter:next?.cursor_date,statusAfter:next?.status};});
  save();writeReport();
  console.log(JSON.stringify({outputDirectory:dir,importedSnapshot:out.importedRows,ordersBefore:out.before.orderCount,ordersAfter:out.after.orderCount,companies:out.companies.map(({source,...e})=>e),progress:out.progress},null,2));
}
function writeReport(){
  const lines=['# Pedidos importados e pendências — '+to,'',`Consulta de ${out.startedAt} a ${out.finishedAt} (timestamps UTC; horário operacional São Paulo). Produção somente em leitura.`,
    '',`Período: **${from} a ${to}**. Todas as situações, inclusive cancelados; não equivale ao total elegível da ABC.`,
    '',`Snapshot de pedidos: **${out.importedRows}**. Contagem global antes/depois: ${out.before.orderCount} / ${out.after.orderCount}. Como o worker está ativo, consultas não compartilham snapshot transacional.`,
    '', '[Lista de pedidos e datas](pedidos-importados.json) · [Dados de cobertura, fonte e jobs](status.json)',
    '', '## Resumo', '', '| Empresa | Pedidos no snapshot, todas situações | Banco não cancelados | Fonte não cancelados | Saldo não cancelados | Última venda presente |', '| --- | ---: | ---: | ---: | ---: | --- |',
    ...out.companies.map(c=>`| ${c.name} | ${c.imported} | ${c.importedNonCancelled} | ${c.sourceNonCancelled??'Não confirmado'} | ${c.nonCancelledDifference??'Não confirmado'} | ${c.lastSale||'—'} |`),
    '', '**Saldo por contagem não é reconciliação ID a ID.** O filtro Olist usa data de criação; a tabela diária usa data comercial persistida. Datas retroativas e bordas de períodos podem divergir. Situações ainda desatualizadas, reprocessamentos, exclusões e vínculos canônicos também afetam o saldo. Hoje é um dia em aberto. Não transformar esse saldo em previsão de horas sem medir o processamento restante.',
    '', 'Cancelamentos: o worker atualiza cancelamento de vendas já conhecidas; quando encontra um pedido cancelado que nunca foi importado, pode não criar uma venda analítica. Portanto, o total bruto de pedidos do ERP não é uma meta de linhas a importar. A conta principal abaixo exclui situação 2 de ambos os lados, mas ainda precisa reconciliar estados atuais. [Contrato de data de criação/situação da API Olist](https://api-docs.erp.olist.com/api-reference/pedidos/listar-pedidos).',
    '', '## Cobertura de varredura confirmada',
    ...out.companies.flatMap(c=>['',`### ${c.name}`,`Importados: ${c.coveredRanges.map(s=>s.from+' a '+s.to).join('; ')||'Nenhum intervalo confirmado'}.`,`Sem cobertura integral: ${c.uncoveredRanges.map(s=>s.from+' a '+s.to).join('; ')||'Nenhum'}.`]),
    '', 'A cobertura significa que a varredura passou por todas as páginas do dia. Não comprova reconciliação com a fonte atual. Pedidos podem existir em dias sem cobertura integral.',
    '', '## Quantidades por janela na fonte', '', '| Empresa | De | Até | Olist total | Cancelados Olist | Não cancelados Olist | Banco não cancelados | Saldo não cancelados |', '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |',
    ...out.companies.flatMap(c=>c.source.map(p=>`| ${c.name} | ${p.from} | ${p.to} | ${p.total} | ${p.cancelled} | ${p.nonCancelled} | ${p.importedNonCancelled} | ${p.nonCancelledDifference} |`)),
    '', '## Pedidos por dia', '', '| Data da venda | Olist 1 | Olist 2 | Olist 3 | Cobertura de varredura |', '| --- | ---: | ---: | ---: | --- |',
    ...daysBetween(from,to).map(day=>{const rows=out.companies.map(c=>out.daily.find(d=>d.connection===c.connection&&d.date===day));return `| ${day} | ${rows.map(r=>r.imported).join(' | ')} | ${rows.filter(r=>r.covered).map(r=>r.company).join(', ')||'Nenhuma conta integral'} |`;}),
    '', '## Continuidade automática', '', 'Cron observado com requisições por minuto; o código agenda incrementais e retoma checkpoints persistentes. Não foi disparado processamento manual. Queued é continuação normal do lote; running é reserva ativa; retry aguarda next_at; failed exige revisão. Incrementais fazem vendas e depois atualizações por dia. O cursor não representa a data da venda mais recente do banco.',
    '', '| Empresa | Modo | Estado final | Cursor antes → depois | Eventos processados antes → depois |', '| --- | --- | --- | --- | --- |',
    ...out.progress.map(p=>`| ${p.company} | ${p.mode} | ${p.statusAfter} | ${p.cursorBefore} → ${p.cursorAfter} | ${p.processedBefore} → ${p.processedAfter} |`),
    '', 'O contador processed inclui reprocessamentos e as duas fases incrementais; não é o número de novas vendas. O agendamento de novas atualizações do mesmo dia tem intervalo mínimo de uma hora após concluir o job. Uma fila longa pode manter a data final atrás de hoje; novos intervalos serão agendados após concluir o incremental ativo. Falhas de autorização, API, cron e quota podem interromper a continuidade.',
    '', '## Repetir a consulta', '', '`node scripts/analytics-import-status.cjs --from='+from+' --to='+to+'`', '', 'O comando grava outro snapshot local e consulta somente GETs. Não renova OAuth nem modifica filas. A tabela pública analytics_orders permite conferir pedidos individuais pelo número/ID; analytics_coverage indica varredura; analytics_sync_jobs mostra cursores e pendências. Os schemas cron/net exigem editor SQL autorizado para conferir status HTTP final.',
  ];
  fs.writeFileSync(dir+'/relatorio.md',lines.join('\n')+'\n');
}
main().catch(e=>{out.error=e.message;save();console.error(JSON.stringify({error:e.message,outputDirectory:dir}));process.exitCode=1;});
