import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { motionCases, verifyMotion } from './group-motion-core.mjs';
const bundle=resolve(process.env.BUNDLE||'dist/lode-flow.iife.js');
const out=process.env.OUT&&resolve(process.env.OUT);
if(out)await mkdir(out,{recursive:true});
const browser=await chromium.launch();
const results=[];
try{
 for(const spec of motionCases){
  const page=await browser.newPage({viewport:{width:1280,height:800},deviceScaleFactor:2});
  const frames=[];const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
   await page.setContent('<style>body{margin:0;background:#e8edf2}lode-flow{display:block;width:1280px;height:800px}</style><lode-flow theme="light"></lode-flow>');
   await page.addScriptTag({content:await readFile(bundle,'utf8')});
   const data=await verifyMotion(page,spec,out?async(spec,p,s)=>{
    frames.push(s);if(p===.5)await page.screenshot({path:resolve(out,spec.name.replaceAll(' ','-')+'.png')});
   }:null);
   if(errors.length)throw Error(errors.join('\n'));
   results.push({name:spec.name,ok:true,data});console.log('✓ '+spec.name);
  }catch(e){results.push({name:spec.name,ok:false,error:e.message,frames});console.log('✗ '+spec.name+': '+e.message);}
  finally{await page.close();}
 }
}finally{await browser.close();}
if(out)await writeFile(resolve(out,'results.json'),JSON.stringify({bundle,results},null,2)+'\n');
console.log(`${results.filter(x=>x.ok).length}/${results.length} motion scenarios passed`);
process.exitCode=results.some(x=>!x.ok)?1:0;
