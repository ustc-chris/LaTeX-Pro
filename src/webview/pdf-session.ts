import * as pdfjs from 'pdfjs-dist';
pdfjs.GlobalWorkerOptions.workerSrc=window.LATEX_PRO_ASSETS.worker;
type Task=ReturnType<typeof pdfjs.getDocument>;
interface Session{key:string;task:Task;refs:number;ready:Promise<pdfjs.PDFDocumentProxy>}
const sessions=new Map<string,Session>();
export function acquirePdf(url:string,revision:string|number,measure:(name:string,ms:number)=>void){const key=url+'\0'+revision;let s=sessions.get(key);if(!s){const started=performance.now(),task=pdfjs.getDocument({url:url+(url.includes('?')?'&':'?')+'lpv='+encodeURIComponent(String(revision)),cMapUrl:window.LATEX_PRO_ASSETS.cmaps,cMapPacked:true,standardFontDataUrl:window.LATEX_PRO_ASSETS.fonts,wasmUrl:window.LATEX_PRO_ASSETS.wasm,enableXfa:false});s={key,task,refs:0,ready:task.promise.then(doc=>{measure('pdf.document.ready',performance.now()-started);return doc;})};sessions.set(key,s);void s.ready.catch(()=>{if(sessions.get(key)===s)sessions.delete(key);void task.destroy();});}else measure('pdf.document.reused',0);s.refs++;const entry=s;for(const [other,old]of sessions)if(other!==key&&!old.refs){sessions.delete(other);void old.task.destroy();}return {ready:entry.ready,release(){entry.refs=Math.max(0,entry.refs-1);if(sessions.size>1&&!entry.refs){sessions.delete(key);void entry.task.destroy();}}};}

export function clearIdlePdf(){for(const [key,s]of sessions)if(!s.refs){sessions.delete(key);void s.task.destroy();}}
