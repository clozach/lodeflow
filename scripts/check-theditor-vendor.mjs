// Portable integrity gate for theditor's derived files. The source generator
// writes the receipt; run its --check in the canonical workspace to compare
// both consumers against the source, including this gate and receipt.
import {createHash} from 'node:crypto';
import {readFileSync, readdirSync, lstatSync} from 'node:fs';
import {dirname, resolve, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)), '..');
const receipt=JSON.parse(readFileSync(resolve(root,'scripts/theditor-vendor.json'),'utf8'));
const walk=p=>readdirSync(p).flatMap(name=>{const f=resolve(p,name),s=lstatSync(f);if(s.isSymbolicLink())throw Error(`Symlink: ${f}`);return s.isDirectory()?walk(f):[f]});
const errors=[];
for(const [file,hash] of Object.entries(receipt.files)) {
  try {if(createHash('sha256').update(readFileSync(resolve(root,file))).digest('hex')!==hash) errors.push(`${file}: changed`);}
  catch {errors.push(`${file}: missing`);}
}
for(const dir of receipt.folders) {
  try {for(const file of walk(resolve(root,dir))){const rel=relative(root,file);if(!receipt.files[rel]&&!rel.endsWith('/.DS_Store'))errors.push(`${rel}: unregistered`);}}
  catch(error){errors.push(`${dir}: ${error.message}`);}
}
if(errors.length){console.error('theditor derived files drifted:\n'+errors.join('\n'));process.exit(1)}
console.log(`theditor: ${Object.keys(receipt.files).length} derived files match the source receipt (${receipt.source.slice(0,12)})`);
