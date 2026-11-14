export const latexProExtensionId='latex-pro-local.latex-pro';
type Affinities=Record<string,unknown>;
function record(value:unknown):Affinities{return value&&typeof value==='object'&&!Array.isArray(value)?{...value as Affinities}:{};}
function positive(value:unknown):value is number{return typeof value==='number'&&Number.isSafeInteger(value)&&value>0;}
function own(key:string){return key.toLowerCase()===latexProExtensionId;}
export function configuredHostAffinity(value:unknown):number{const entries=Object.entries(record(value));const current=entries.find(([id])=>own(id))?.[1];return positive(current)?current:0;}
export function planHostIsolation(effective:unknown,workspace:unknown){
 const merged=record(effective),local=record(workspace),key=Object.keys(merged).find(own)||latexProExtensionId;
 const used=new Set(Object.entries(merged).filter(([id,value])=>!own(id)&&positive(value)).map(([,value])=>value as number));
 let affinity=configuredHostAffinity(merged);if(!affinity||used.has(affinity)){affinity=1;while(used.has(affinity))affinity++;}
 const value=Object.fromEntries(Object.entries(local).filter(([id])=>!own(id)));value[key]=affinity;
 return {value,affinity,changed:Object.keys(local).length!==Object.keys(value).length||Object.keys(value).some(id=>JSON.stringify(local[id])!==JSON.stringify(value[id]))};
}
export function removeHostIsolation(workspace:unknown):Affinities|undefined{const value=Object.fromEntries(Object.entries(record(workspace)).filter(([id])=>!own(id)));return Object.keys(value).length?value:undefined;}
