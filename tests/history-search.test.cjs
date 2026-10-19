require('./setup.cjs');
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {isolatedDatabase,ws}=require('../scripts/analytics-isolated.cjs');
let db;
const operator='10000000-0000-4000-8000-000000000071';
const outsider='10000000-0000-4000-8000-000000000072';
const blocked='10000000-0000-4000-8000-000000000073';
const foreign='10000000-0000-4000-8000-000000000074';
before(async()=>{
  db=await isolatedDatabase();
  const migration=readFileSync('supabase/migration_v17_batch_history_search.sql','utf8');
  await db.exec(migration);await db.exec(migration);
  await db.exec('GRANT USAGE ON SCHEMA auth TO authenticated; GRANT SELECT ON public.lotes_bipagem TO authenticated;');
  for(const id of [operator,outsider,blocked])await db.query('INSERT INTO auth.users(id) VALUES($1)',[id]);
  await db.query('INSERT INTO workspaces(id) VALUES($1)',[foreign]);
  for(const [id,workspace,active] of [[operator,ws,true],[outsider,foreign,true],[blocked,ws,false]])
    await db.query("INSERT INTO workspace_members(user_id,workspace_id,role,active) VALUES($1,$2,'operator',$3) ON CONFLICT(user_id) DO UPDATE SET workspace_id=$2,active=$3",[id,workspace,active]);
  for(let i=0;i<61;i++)await db.query(`INSERT INTO lotes_bipagem(workspace_id,owner_id,responsavel,qtd_pedidos,pedidos,created_at)
    VALUES($1,$1,'Equipe',1,$2,'2026-10-19T12:00:00Z')`,[ws,JSON.stringify([{id:i,clientName:'Cliente recente',trackingCode:'NEW'+i,numeroPedido:10000+i,status:'checked'}])]);
  await db.query(`INSERT INTO lotes_bipagem(workspace_id,owner_id,responsavel,qtd_pedidos,pedidos,created_at)
    VALUES($1,$1,'Histórico',3,$2,'2025-01-01T12:00:00Z')`,[ws,JSON.stringify([
    {id:1,clientName:'João Gonçalves',trackingCode:'AA123456789BR',numeroPedido:7925,nuvemshopNumber:'116',yampiId:'LEGADO-88',status:'checked'},
    {id:2,clientName:'Outra pessoa',trackingCode:'OUTRO',numeroPedido:8123,status:'checked'},
    {id:3,clientName:'Etiqueta 100%_ok',trackingCode:'ESPECIAL',ecommerceChannelOrderNumber:'MARKET-123'},
  ])]);
  await db.query(`INSERT INTO lotes_bipagem(workspace_id,owner_id,responsavel,qtd_pedidos,pedidos)
    VALUES($1,$2,'Outro workspace',1,$3)`,[foreign,outsider,JSON.stringify([{clientName:'João Gonçalves',trackingCode:'AA123456789BR',numeroPedido:7925,status:'checked'}])]);
});
after(async()=>db?.close());
async function search(query,offset=0,actor=operator,workspace=ws,limit=20){
  await db.exec('BEGIN');
  try{
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[actor]);
    await db.exec('SET LOCAL ROLE authenticated');
    return(await db.query('SELECT search_workspace_batches($1,$2,$3,$4) result',[workspace,query,offset,limit])).rows[0].result;
  }finally{await db.exec('ROLLBACK');}
}
test('search reaches old completed orders beyond the newest 50 batches, by all saved references',async()=>{
  for(const q of ['joao goncalves','JOÃO','aa123456789br','7925','116','LEGADO-88','MARKET-123']){
    const r=await search(q);assert.equal(r.total,1,q);assert.equal(r.matchingOrders,1,q);
    assert.equal(r.batches[0].pedidos.length,3);
    assert.equal(r.batches[0].matchedOrders.length,1);
    assert.match(r.batches[0].created_at,/2025-01-01/);
  }
});
test('wildcards are literal, empty results are explicit and a name on another order is not returned',async()=>{
  for(const q of ['100%_ok','%','_'])assert.equal((await search(q)).matchingOrders,1);
  const none=await search("' OR true --");assert.equal(none.total,0);assert.deepEqual(none.batches,[]);
  const r=await search('7925');assert.equal(r.batches[0].matchedOrders[0].numeroPedido,7925);
  assert.equal(r.batches[0].pedidos[1].numeroPedido,8123);
});
test('pagination keeps stable order and searches all batches before limiting the result',async()=>{
  const a=await search('Cliente recente'),b=await search('Cliente recente',20),c=await search('Cliente recente',40),d=await search('Cliente recente',60);
  assert.equal(a.total,61);assert.equal(a.matchingOrders,61);
  assert.equal(a.batches.length,20);assert.equal(b.batches.length,20);assert.equal(c.batches.length,20);assert.equal(d.batches.length,1);
  assert.equal(new Set([...a.batches,...b.batches,...c.batches,...d.batches].map(b=>b.id)).size,61);
  assert.deepEqual((await search('Cliente recente')).batches.map(b=>b.id),a.batches.map(b=>b.id));
});
test('membership and RLS isolate workspaces, block inactive users and reject invalid search limits',async()=>{
  await assert.rejects(search('Joao',0,outsider),/MEMBER_REQUIRED/);
  await assert.rejects(search('Joao',0,blocked),/MEMBER_REQUIRED/);
  await assert.rejects(search('Joao',0,operator,foreign),/MEMBER_REQUIRED/);
  const other=await search('Joao',0,outsider,foreign);assert.equal(other.total,1);assert.equal(other.batches[0].responsavel,'Outro workspace');
  for(const [q,offset,limit]of [['',0,20],['a'.repeat(201),0,20],['a',-1,20],['a',0,51]])
    await assert.rejects(search(q,offset,operator,ws,limit),/INVALID_SEARCH/);
  const p=(await db.query("SELECT provolatile,prosecdef,has_function_privilege('anon',oid,'execute') anonymous FROM pg_proc WHERE proname='search_workspace_batches'")).rows[0];
  assert.equal(p.provolatile,'s');assert.equal(p.prosecdef,false);assert.equal(p.anonymous,false);
});
