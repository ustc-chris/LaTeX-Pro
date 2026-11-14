import {createHash} from 'node:crypto';
export interface TextPatch{start:number;before:string;after:string;beforeHash:string;afterHash:string}
export interface HistoryChange{file:string;id?:string;patch:TextPatch;renameTo?:string}
export interface Operation{kind:'work'|'map'|'disk';changes:HistoryChange[];at:number;ai?:boolean;sealed?:boolean;committed?:boolean}
export interface HistoryData{undo:Operation[];redo:Operation[]}
export const textHash=(text:string)=>createHash('sha256').update(text).digest('hex');
export function makePatch(before:string,after:string):TextPatch{let start=0,end=0;while(start<before.length&&start<after.length&&before[start]===after[start])start++;while(end<before.length-start&&end<after.length-start&&before[before.length-end-1]===after[after.length-end-1])end++;return {start,before:before.slice(start,before.length-end),after:after.slice(start,after.length-end),beforeHash:textHash(before),afterHash:textHash(after)};}
export function patchText(text:string,p:TextPatch,redo:boolean){if(textHash(text)!==(redo?p.beforeHash:p.afterHash))throw Error('内容已变化，已保留草稿并停止撤销，请先核对冲突');const old=redo?p.before:p.after,next=redo?p.after:p.before;return text.slice(0,p.start)+next+text.slice(p.start+old.length);}
export class OperationHistory{
 data:HistoryData;limit:number;
 constructor(data:HistoryData|undefined,limit=335){this.data=data&&Array.isArray(data.undo)&&Array.isArray(data.redo)?data:{undo:[],redo:[]};this.limit=limit;this.trim();}
 trim(){this.limit=Math.min(10000,Math.max(10,Math.floor(this.limit)||335));while(this.data.undo.length+this.data.redo.length>this.limit){if(this.data.undo.length)this.data.undo.shift();else this.data.redo.shift();}}
 record(kind:Operation['kind'],changes:{file:string;id?:string;before:string;after:string;renameTo?:string}[],ai=false,at=Date.now()){
 const changed=changes.filter(c=>c.before!==c.after||c.renameTo);if(!changed.length)return false;
 const last=this.data.undo.at(-1),c=changed[0],previous=last?.changes[0];
 if(kind!=='disk'&&changed.length===1&&last&&!last.sealed&&last.kind===kind&&last.changes.length===1&&previous?.file===c.file&&previous.id===c.id&&at-last.at<1000&&previous.patch.afterHash===textHash(c.before)){
 const original=patchText(c.before,previous.patch,false);previous.patch=makePatch(original,c.after);last.at=at;if(original===c.after)this.data.undo.pop();
 }else this.data.undo.push({kind,ai,at,changes:changed.map(({before,after,...target})=>({...target,patch:makePatch(before,after)}))});
 this.data.redo=[];this.trim();return true;
 }
 markFileSaved(file:string){for(const op of [...this.data.undo,...this.data.redo])if(op.kind!=='disk'&&op.changes.some(c=>c.file===file))op.committed=true;this.seal();}
 markSaved(kind:Operation['kind'],file:string,id?:string){for(const op of [...this.data.undo,...this.data.redo])if(op.kind===kind&&op.changes.some(c=>c.file===file&&c.id===id))op.committed=true;this.seal();}
 seal(){const last=this.data.undo.at(-1);if(last)last.sealed=true;}
 peek(redo:boolean){return (redo?this.data.redo:this.data.undo).at(-1);}
 complete(redo:boolean){const from=redo?this.data.redo:this.data.undo,to=redo?this.data.undo:this.data.redo,entry=from.pop();if(entry){entry.sealed=true;to.push(entry);}this.trim();}
}
