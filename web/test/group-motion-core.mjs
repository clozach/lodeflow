// Shared by full browser regressions and old/new visual capture. Freeze only the
// fixture clock: the component's real draw() writes the DOM at each sampled frame.
import assert from 'node:assert/strict';
export const motionCases = [
  { name: 'single collapse', collapsed: true },
  { name: 'single expand', collapsed: false },
  { name: 'bulk collapse and fit', collapsed: true, bulk: true, fit: true },
  { name: 'bulk expand and fit', collapsed: false, bulk: true, fit: true },
  { name: 'nested ancestor collapse', collapsed: true, nested: true, bulk: true, fit: true },
  { name: 'nested ancestor expand', collapsed: false, nested: true, bulk: true, fit: true },
  { name: 'radial collapse', collapsed: true, orient: 'in-out', bulk: true, fit: true },
  { name: 'radial expand', collapsed: false, orient: 'in-out', bulk: true, fit: true },
  { name: 'junction collapse', collapsed: true, junction: true, bulk: true, fit: true },
  { name: 'junction expand', collapsed: false, junction: true, bulk: true, fit: true },
  { name: 'interrupted reverse', collapsed: true, nested: true, bulk: true, fit: true, reverse: true },
  { name: 'interrupted Undo', collapsed: true, nested: true, bulk: true, fit: true, undo: true },
];
export function motionSeed({ collapsed, nested, orient = 'lr' }) {
  return {
    nodes: [{id:'a',text:'First member',group:nested?'inner':'outer'}, {id:'b',text:'Second member',group:nested?'inner':'outer'}, {id:'c',text:'Third member',group:'outer'}, {id:'d',text:'Outside'}, {id:'e',text:'Other member',group:'other'}],
    edges: [{id:'ab',from:'a',to:'b',label:'Inside label'}, {id:'bc',from:'b',to:'c',label:'Outer label'}, {id:'cd',from:'c',to:'d'}, {id:'ed',from:'e',to:'d'}],
    groups: [{id:'outer',text:'Outer group',collapsed:!collapsed}, ...(nested?[{id:'inner',text:'Nested group',parent:'outer',collapsed:!collapsed}]:[]), {id:'other',text:'Other group',collapsed:!collapsed}],
    settings: {orientation:orient,tightGroups:true,untangle:true},
  };
}
export async function sampleMotion(page, progress) {
  return page.evaluate(progress=>{
    const f=document.querySelector('lode-flow');
    window.__motionClock=f.t0+f.dur*progress;
    f.draw();
    const world=new DOMMatrix(getComputedStyle(f.world).transform).inverse();
    const host=f.getBoundingClientRect();
    const point=(x,y)=>{const p=new DOMPoint(x-host.x,y-host.y).matrixTransform(world);return {x:p.x,y:p.y};};
    const rect=e=>{const r=e.getBoundingClientRect();const c=point(r.x+r.width/2,r.y+r.height/2);return {...c,w:r.width/f.camShown.z,h:r.height/f.camShown.z,o:Number(e.style.opacity||1)};};
    const edges=Object.fromEntries([...f.edgeEls].map(([id,e])=>{if(!e.path.getAttribute('d'))return [id,null];const p=e.path.getPointAtLength(e.path.getTotalLength()/2);return [id,{x:p.x,y:p.y,o:Number(e.path.style.opacity||1)}];}));
    return {progress,nodes:Object.fromEntries([...f.nodeEls].map(([id,e])=>[id,rect(e)])),groups:Object.fromEntries([...f.groupEls].map(([id,e])=>[id,{proxy:rect(e.proxy),box:rect(e.box),label:rect(e.label)}])),carriers:Object.fromEntries([...f.carrierEls].map(([id,e])=>[id,rect(e)])),edges,selection:f.selection,history:f.hist.entries.map(e=>e.kind)};
  },progress);
}
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const near=(a,b,label,tolerance=.5)=>assert.ok(distance(a,b)<tolerance,`${label}: ${distance(a,b).toFixed(3)} world px`);
export async function verifyMotion(page, spec, capture) {
  await page.evaluate(seed=>document.querySelector('lode-flow').setDoc(seed),(() => { const seed=motionSeed(spec); if(spec.junction){seed.junctions=[{id:'join'}];seed.edges=[{id:'aj',from:'a',to:'join'},{id:'bj',from:'b',to:'join'},{id:'jc',from:'join',to:'c',label:'Shared label'},...seed.edges.slice(2)];}return seed;})());
  await page.waitForTimeout(600);
  await page.evaluate(()=>{
    const f=document.querySelector('lode-flow');
    f.select(['outer']); f.tun.animMs=1000;
    window.__motionClock=performance.now();
    performance.now=()=>window.__motionClock;
  });
  const before=await sampleMotion(page,1);
  await page.evaluate(spec=>{
    const f=document.querySelector('lode-flow');
    window.__motionClock+=2000;
    if(spec.bulk)f.setAllGroupsCollapsed(spec.collapsed,{fit:!!spec.fit});
    else f.shadowRoot.querySelector('.vp').focus();
  },spec);
  if(!spec.bulk)await page.keyboard.press('c');
  await page.waitForFunction(collapsed=>document.querySelector('lode-flow').geo.groups.get('outer').shape.kind===(collapsed?'proxy':document.querySelector('lode-flow').doc.settings.orientation==='in-out'?'sector':'rect'),spec.collapsed);
  const samples=[];
  for(const p of [0,.25,.5,.75,.99,1]){
    const s=await sampleMotion(page,p); samples.push(s);
    if(capture)await capture(spec,p,s);
  }
  const zero=samples[0], mid=samples[2], almost=samples[4], end=samples[5];
  if(!spec.orient)near(mid.groups.outer.box,mid.groups.outer.proxy,'outline and moving proxy share the middle-frame center');
  const origin=spec.collapsed?almost.groups.outer.proxy:zero.groups.outer.proxy;
  const at=spec.collapsed?almost:zero;
  for(const id of ['a','b','c'])near(at.nodes[id],origin,`${id} begins/ends at the proxy`);
  for(const id of (spec.junction?['j:join']:['l:ab','l:bc']))near(at.carriers[id],origin,`${id} begins/ends at the proxy`);
  for(const id of (spec.junction?['aj','bj','jc']:['ab','bc']))near(at.edges[id],origin,`${id} route begins/ends at the proxy`);
  if(spec.nested)near(at.groups.inner.proxy,origin,'hidden nested proxy folds into visible ancestor');
  if(!spec.collapsed)assert.ok(zero.nodes.a.w<end.nodes.a.w*.7,'appearing card starts shrunken');
  assert.deepEqual(end.selection,['outer'],'selection is preserved');
  if(spec.reverse||spec.undo){
    await page.evaluate(()=>{
      const f=document.querySelector('lode-flow');window.__motionClock+=2000;f.setAllGroupsCollapsed(false,{fit:true});
    });
    await page.waitForFunction(()=>document.querySelector('lode-flow').geo.groups.get('outer').shape.kind==='rect');
    const halfway=await sampleMotion(page,.5);
    await page.evaluate(undo=>{
      const f=document.querySelector('lode-flow');if(undo)f.undo();else f.setAllGroupsCollapsed(true,{fit:true});
    },!!spec.undo);
    await page.waitForFunction(()=>document.querySelector('lode-flow').geo.groups.get('outer').shape.kind==='proxy');
    const reversed=await sampleMotion(page,0);
    near(reversed.groups.outer.proxy,halfway.groups.outer.proxy,'interrupted proxy stays in place');
    near(reversed.groups.outer.box,halfway.groups.outer.box,'interrupted outline stays in place');
    near(reversed.nodes.a,halfway.nodes.a,'interrupted member stays in place');
    near(reversed.carriers['l:ab'],halfway.carriers['l:ab'],'interrupted label stays in place');
    assert.ok(Math.abs(reversed.nodes.a.w-halfway.nodes.a.w)<.2,'interrupted card keeps its scale');
    samples.push({interrupt:{halfway,reversed}});
  }
  return {before,samples};
}
