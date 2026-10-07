import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { chromium, firefox, webkit } from 'playwright';
const bundle = await readFile(process.env.LF_BUNDLE || new URL('../dist/lode-flow.iife.js', import.meta.url));
const server = createServer((req,res) => {
  res.setHeader('content-type', req.url === '/bundle.js' ? 'text/javascript' : 'text/html');
  res.end(req.url === '/bundle.js' ? bundle : '<!doctype html><style>body{margin:0}lode-flow{height:100vh}</style><script src="/bundle.js"></script><lode-flow storage-key="rotation-test"></lode-flow>');
});
await new Promise(r => server.listen(0,'127.0.0.1',r));
const url = `http://127.0.0.1:${server.address().port}`;
const rad = d => d * Math.PI / 180;
const near = (a,b,label) => assert.ok(Math.abs(a-b)<1e-6,`${label}: ${a} versus ${b}`);
const cam = p => p.locator('lode-flow').evaluate(f=>f.camera);
const seed = async (p,r) => {
  await p.locator('lode-flow').evaluate((f,r)=>{
    f.tun.animation=0;
    f.setState({doc:{nodes:[{id:'a',text:'Upright again'},{id:'b',text:'Keep the connection'}],edges:[{id:'ab',from:'a',to:'b'}],groups:[],junctions:[],settings:{orientation:'tb'}},view:{cam:{x:0,y:0,z:1,r},follow:false,sel:[]}});
    f.focus();
  },rad(r));
  await p.waitForTimeout(60);
};
async function wheel(p,degrees) {
  await p.mouse.move(620,450);await p.keyboard.down('Alt');
  const delta = Math.round(rad(degrees)/0.003);
  await p.mouse.wheel(0,delta);await p.keyboard.up('Alt');
  await p.waitForTimeout(70);return delta * 0.003;
}
const results=[];
try {
 for(const [name,engine] of Object.entries({chromium,firefox,webkit})){
  if(process.env.BROWSERS&&!process.env.BROWSERS.split(',').includes(name))continue;
  const browser=await engine.launch(),context=await browser.newContext({viewport:{width:900,height:650},hasTouch:true,reducedMotion:'reduce'}),p=await context.newPage(),errors=[];
  p.on('pageerror',e=>errors.push(e.message));
  try {
   await p.goto(url);await p.waitForFunction(()=>document.querySelector('lode-flow')?.layoutInfo);
   for(const sign of [-1,1]){
    await seed(p,sign*10);await wheel(p,-sign*7.1);near((await cam(p)).r,0,'wheel snaps near zero');
    await p.keyboard.press('ControlOrMeta+z');near((await cam(p)).r,rad(sign*10),'undo preserves starting tilt');
    await p.keyboard.press('ControlOrMeta+Shift+z');near((await cam(p)).r,0,'redo restores upright');
   }
   results.push(`${name}: wheel snap from both sides, Undo and Redo`);
   await seed(p,10);const outsideDelta=await wheel(p,-6.9);near((await cam(p)).r,rad(10)+outsideDelta,'outside threshold keeps tilt');
   await seed(p,358);await wheel(p,1);near((await cam(p)).r,0,'full turn snaps upright');
   results.push(`${name}: outside threshold and full-turn boundary`);
   await seed(p,0);let intended=0;for(let i=0;i<4;i++)intended+=await wheel(p,1);near((await cam(p)).r,intended,'small ticks can escape snap zone');
   await p.waitForTimeout(550);await wheel(p,-2);near((await cam(p)).r,0,'new wheel burst snaps');
   await p.waitForTimeout(550);await wheel(p,-1);near((await cam(p)).r,0,'new burst discards old wheel intent');
   results.push(`${name}: small ticks escape; separate bursts reset intent`);
   await seed(p,17);await p.keyboard.press('[');near((await cam(p)).r,0,'keyboard rotate snaps too');
   await p.keyboard.press(']');near((await cam(p)).r,rad(15),'keyboard leaves zero');
   await p.keyboard.press('r');near((await cam(p)).r,0,'upright shortcut');
   results.push(`${name}: keyboard rotation uses same snap`);
   if(name==='chromium'){
    const cdp=await context.newCDPSession(p);
    const points=(degrees,radius=100)=>[0,1].map((id)=>({id,x:450+(id?1:-1)*radius*Math.cos(rad(degrees)),y:450+(id?1:-1)*radius*Math.sin(rad(degrees))}));
    for(const sign of [-1,1]){
     await seed(p,sign*20);
     await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points(0)});
     await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:points(-sign*17.1)});
     await p.waitForTimeout(50);
     near((await cam(p)).r,0,'touch snaps while fingers are down');
     await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:points(-sign*16.9)});
     await p.waitForTimeout(50);
     near((await cam(p)).r,rad(sign*3.1),'touch can leave snap zone');
     await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:points(-sign*18,120)});
     await p.waitForTimeout(50);
     near((await cam(p)).r,0,'combined twist and zoom snaps');near((await cam(p)).z,1.2,'zoom retained');
     await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
     const final=await cam(p);await p.keyboard.press('ControlOrMeta+z');near((await cam(p)).r,rad(sign*20),'one undo restores whole touch gesture');
     await p.keyboard.press('ControlOrMeta+Shift+z');assert.deepEqual(await cam(p),final);
    }
    results.push('chromium: real two-finger twist, threshold crossing, zoom and one-step history');
    // Tap each node separately: selection replaces rather than accumulates without a keyboard modifier.
    await p.locator('lode-flow').evaluate(f=>f.fit());await p.waitForTimeout(100);
    for(const id of ['a','b']){await p.locator(`.node[data-id="${id}"]`).tap();assert.deepEqual(await p.locator('lode-flow').evaluate(f=>f.selection),[id]);}
    results.push('chromium: confirmed ordinary touch taps select only one node');
   }
   await seed(p,10);await wheel(p,-8);await p.waitForTimeout(650);await p.reload();await p.waitForFunction(()=>document.querySelector('lode-flow')?.layoutInfo);near((await cam(p)).r,0,'saved upright survives reload');
   results.push(`${name}: snapped rotation persists`);
   assert.deepEqual(errors,[]);
  }finally{await context.close();await browser.close();}
 }
 console.log(results.join('\n'));console.log(`${results.length} rotation checks pass`);
}finally{await new Promise(r=>server.close(r));}
