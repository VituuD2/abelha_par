require('./setup.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs=require('node:fs');
const Module=require('node:module');
const ts=require('typescript');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
require.extensions['.tsx']=(module,filename)=>{
  const {outputText}=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}});
  module._compile(outputText,filename);
};
const original=Module._load;
Module._load=function(name,...args){if(name==='next/navigation')return{usePathname:()=>'/'};return original.call(this,name,...args)};
const {Sidebar}=require('../src/components/layout/sidebar.tsx');
Module._load=original;

test('both desktop and mobile navigation omit Ninho for an operator',()=>{
  const html=renderToStaticMarkup(React.createElement(Sidebar,{isAdmin:false}));
  assert.equal((html.match(/href="\/ninho"/g)||[]).length,0);
  assert.ok(html.includes('href="/scanner"'));assert.ok(html.includes('href="/orders"'));
});
test('both desktop and mobile navigation include Ninho for a verified admin',()=>{
  const html=renderToStaticMarkup(React.createElement(Sidebar,{isAdmin:true}));
  assert.equal((html.match(/href="\/ninho"/g)||[]).length,2);
});
