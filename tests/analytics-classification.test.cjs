require('./setup.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const catalog=require('../src/lib/analytics/data/composition-catalog.json');
const bases=require('../src/lib/analytics/data/base-products.json');
const classification=require('../src/lib/analytics/data/composition-classification.json');
const {buildCompositionRules}=require('../src/lib/analytics/composition.ts');
const {compositionRulesForWorkspace}=require('../src/lib/analytics/composition-server.ts');
const {rules}=require('./legacy-composition-rules.cjs');

test('all simple inventory products become canonical stock units, with TESTE retained for review',()=>{
  assert.equal(bases.products.length,120);
  assert.equal(new Set(bases.products.map(p=>p.sku)).size,120);
  assert.equal(classification.baseSourceSha256,bases.source.sha256);
  for(const base of bases.products.filter(p=>p.eligible))assert.deepEqual(rules.rules[base.sku],{target:base.sku,name:base.name,factor:'1'});
  for(const sku of ['ACOP000-K036','ACUN000-K012','HBEL000-K002','CXPD-0001'])assert.equal(rules.rules[sku].factor,'1');
  assert.equal(rules.rules['00000'],undefined);
  assert.match(rules.pending['00000'],/TESTE/);
});

test('Camel Toe and typo variants use the stated kit quantity rather than numeric SKU suffixes',()=>{
  assert.deepEqual(rules.rules['ACAI000-K002'],{target:'ACAI000-K001',name:'Adesivo Intimo Camel Toe',factor:'2'});
  assert.equal(rules.rules['HBCO40M-K022S'].factor,'2');
  assert.equal(rules.rules['HBCO40M-K022S'].target,'HBCO40M-K001');
  assert.equal(rules.rules['ACOP000-K036S'].factor,'1');
  assert.equal(rules.rules['HBCOMAX-K006S'].factor,'6');
  assert.equal(rules.rules['ACAI000-K999S'],undefined);
});

test('cross-family variant codes retain physical model, shape, size and flavor distinctions',()=>{
  for(const [source,target]of [
    ['SBES001-K001S','SBES000-K001'],['SBES004-K001S','SBES002-K001'],['SBES005-K001S','SBES003-K001'],
    ['SBEL000-K001SS','SBEL000-K001'],['SBEC000-K001S','SBEC000-K001'],
    ['COPU-1','SBPB00P-K001'],['COPU-3','SBPB00O-K001'],['COPU-4','SBPB00T-K001'],
    ['ACESM15-K001S','ACESM15-K001'],['SBCC001-K002S','SBCC001-K001']
  ])assert.equal(rules.rules[source].target,target);
  assert.equal(rules.rules['SBCC001-K002S'].factor,'2');
  assert.notEqual(rules.rules['SBCC001-K001'].target,rules.rules['SBCC000-K001'].target);
  assert.notEqual(rules.rules['CMPO0B3-K001'].target,rules.rules['CMPO00B-K001'].target);
  for(const sku of ['SBGF00M-K001','SHGF00M-K001','GOUT00M-K001'])assert.equal(rules.rules[sku].target,sku);
});

test('new packaged tape link follows the approved policy and becomes pending if that policy changes',()=>{
  assert.equal(rules.rules['ACBF000-K050E'].target,'ACBF000-K050');
  assert.equal(rules.rules['ACBF000-K050E'].factor,'1');
  assert.deepEqual(rules.rules['ACBF000-K050E'].ignoredComponents,['EBBF001-001']);
  assert.deepEqual(rules.unlinkedRules['ACBF000-K050E'],rules.rules['ACBF000-K050E']);
  const noExclusion=buildCompositionRules(classification.aliases,catalog.version,[]);
  assert.equal(noExclusion.rules['ACBF000-K050E'],undefined);
  assert.match(noExclusion.pending['ACBF000-K050E'],/auxiliar/);
  assert.equal(noExclusion.unlinkedRules['ACBF000-K050E'],undefined);
});

test('owner confirmation maps exactly the Nivea three-pack even for unlinked sales, without authorizing related SKUs',()=>{
  const approved=compositionRulesForWorkspace(catalog.workspaceIds[0]);
  assert.equal(classification.version,catalog.version);
  assert.equal(approved.rules['CMNV150-K003'].target,'CMNV150-K001');
  assert.equal(approved.rules['CMNV150-K003'].factor,'3');
  assert.deepEqual(approved.unlinkedRules['CMNV150-K003'],approved.rules['CMNV150-K003']);
  for(const sku of ['CMNV150-K001','CMNV150-K003S','ACBF000-K050','ACBF000-K050ES'])
    assert.equal(approved.unlinkedRules[sku],undefined);
  assert.equal(approved.pending['CMNV150-K003'],undefined);
  assert.equal(approved.pending['ACBF000-K050E'],undefined);
});

test('confirmed Corega stock units are tubes; bottle kits use SoulBM bottles and premium scraper',()=>{
  for(const [sku,factor] of [['HBCOMAX-K003','3'],['HBCOMAX-K004','4'],['HBCOMAX-K006','6']]) {
    assert.equal(rules.rules[sku].target,'HBCOMAX-K001');
    assert.equal(rules.rules[sku].factor,factor);
    assert.equal(rules.pending[sku],undefined);
  }
  for(const [sku,bottle] of [['KITGR-M001S','SBGF00M-K001'],['KITGR-G001S','SBGF00G-K001'],['AKGMR-R001','SBGF00M-K001']]) {
    assert.equal(rules.rules[sku],undefined);
    assert.equal(rules.pending[sku],undefined);
    assert.deepEqual(rules.bundles[sku].components.map(c=>[c.target,c.factor]),[[bottle,'1'],['SBLL001-K001','1']]);
    assert.ok(rules.bundles[sku].components.every(c=>BigInt(rules.referenceCosts[c.target])>0n));
  }
  assert.equal(catalog.kits.find(k=>k.sku==='HBCOMAX-K004').components[0].quantity,'4');
  assert.equal(catalog.kits.find(k=>k.sku==='HBCOMAX-K006').components[0].quantity,'6');
  assert.equal(classification.warnings[0].sku,'ACESG15-K001');
  assert.equal(rules.rules['ACESG15-K001S'].target,'ACESG15-K001');
});
