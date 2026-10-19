require('./setup.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),Module=require('node:module'),ts=require('typescript');
const {NextRequest}=require('next/server');
const {can,permissionsFor,PERMISSIONS,permissionForPage}=require('../src/lib/permissions.ts');
const access=require('../src/lib/access.ts');
const auth=require('../src/lib/auth.ts');
const admin=require('../src/lib/supabase/admin.ts');
require.extensions['.tsx']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,filename);
let member={workspace_id:'workspace',active:true,role:'operator'},user={id:'verified-user',user_metadata:{role:'admin'}},failure=null;
const original=Module._load;
Module._load=function(name,...args){
  if(name==='@supabase/ssr')return {createServerClient(_url,_key,options){return {
    auth:{async getUser(){options.cookies.setAll([{name:'renewed',value:'cookie',options:{httpOnly:true}}]);return {data:{user}};}},
    from(table){assert.equal(table,'workspace_members');const q={select(){return q},eq(k,v){assert.equal(k,'user_id');assert.equal(v,user.id);return q},abortSignal(){return q},async maybeSingle(){return {data:member,error:failure}}};return q;},
  };}};
  if(name==='next/navigation')return {redirect(destination){throw Object.assign(new Error('REDIRECT'),{destination});}};
  return original.call(this,name,...args);
};
const {middleware}=require('../src/middleware.ts');
const {default:NinhoPage}=require('../src/app/ninho/page.tsx');
const {default:NinhoLayout}=require('../src/app/ninho/layout.tsx');
Module._load=original;

test('permission policy denies unknown roles and capabilities; route matching protects the entire Ninho subtree',()=>{
  for(const permission of PERMISSIONS){assert.equal(can('admin',permission),true);assert.equal(can('operator',permission),['app:access','analytics:read','analytics:export'].includes(permission));}
  for(const role of [null,undefined,'superadmin','constructor','ADMIN',{},true])assert.deepEqual(permissionsFor(role),[]);
  assert.equal(can('admin','unknown:capability'),false);
  for(const path of ['/ninho','/ninho/','/ninho/users'])assert.equal(permissionForPage(path),'ninho:access');
  for(const path of ['/','/ninho-falso','/analytics/abc'])assert.equal(permissionForPage(path),null);
});

test('middleware denies operators, inactive members and unavailable permission storage before HTML is delivered',async()=>{
  user={id:'verified-user',user_metadata:{role:'admin'}};
  for(const [row,error] of [[{workspace_id:'workspace',active:true,role:'operator'},null],[{workspace_id:'workspace',active:false,role:'admin'},null],[{workspace_id:'workspace',active:true,role:'unknown'},null],[null,null],[null,{message:'unavailable'}]]){
    member=row;failure=error;
    for(const path of ['/ninho','/ninho/users']){
      const r=await middleware(new NextRequest('https://app.test'+path));
      assert.equal(r.status,307);assert.equal(r.headers.get('location'),'https://app.test/');
      assert.match(r.headers.get('cache-control'),/private.*no-store/);assert.equal(r.headers.get('vary'),'Cookie');
      assert.equal(r.cookies.get('renewed').value,'cookie');
    }
  }
  member={workspace_id:'workspace',active:true,role:'admin'};failure=null;
  const allowed=await middleware(new NextRequest('https://app.test/ninho'));
  assert.equal(allowed.status,200);assert.match(allowed.headers.get('cache-control'),/no-store/);
  user=null;
  const anonymous=await middleware(new NextRequest('https://app.test/ninho'));
  assert.match(anonymous.headers.get('location'),/\/login\?next=%2Fninho/);
});

test('page and subtree guard independently reject direct calls and recheck a demoted member without trusting middleware or JWT metadata',async t=>{
  let role='admin',reads=0;
  t.mock.method(auth,'getAuthenticatedUser',async()=>({id:'same-user',user_metadata:{role:'admin'}}));
  t.mock.method(admin,'createAdminClient',()=>({from(){const q={select(){return q},eq(){return q},async maybeSingle(){reads++;return {data:{workspace_id:'workspace',active:true,role},error:null};}};return q;}}));
  assert.ok(await NinhoPage());
  role='operator';
  await assert.rejects(NinhoPage(),e=>e.destination==='/');
  await assert.rejects(NinhoLayout({children:'SECRET'}),e=>e.destination==='/');
  const denied=await access.authorize('members:manage');
  assert.equal(denied.response.status,403);assert.match(denied.response.headers.get('cache-control'),/no-store/);
  assert.equal(reads,4);
  t.mock.method(auth,'getAuthenticatedUser',async()=>null);
  await assert.rejects(NinhoPage(),e=>e.destination==='/login');
});
