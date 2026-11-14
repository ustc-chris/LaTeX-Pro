import {Session} from 'node:inspector';

export interface CpuProfileNode{id:number;callFrame:{functionName:string;url:string;lineNumber:number;columnNumber?:number};children?:number[]}
export interface CpuProfile{nodes:CpuProfileNode[];samples?:number[];timeDeltas?:number[];startTime:number;endTime:number}
export interface ExtensionPath{id:string;path:string}
export function summarizeProfile(profile:CpuProfile,extensions:ExtensionPath[]){
 const nodes=new Map(profile.nodes.map(n=>[n.id,n])),parents=new Map<number,number>();for(const n of profile.nodes)for(const child of n.children||[])parents.set(child,n.id);
 const normalize=(url:string)=>{try{return decodeURIComponent(url.replace(/^file:\/\//,'' )).replaceAll('\\','/');}catch{return url.replaceAll('\\','/');}};
 const paths=extensions.map(e=>({...e,path:normalize(e.path).replace(/\/$/,'')+'/'})).sort((a,b)=>b.path.length-a.path.length),owners=new Map<number,string>();
 const owner=(id:number)=>{if(owners.has(id))return owners.get(id)!;let cursor:number|undefined=id;const seen=new Set<number>();while(cursor!==undefined&&!seen.has(cursor)){seen.add(cursor);const frame=nodes.get(cursor)?.callFrame;if(frame){const url=normalize(frame.url),ext=paths.find(e=>url.startsWith(e.path));if(ext){owners.set(id,ext.id);return ext.id;}if(frame.functionName==='(idle)'){owners.set(id,'(idle)');return '(idle)';}}cursor=parents.get(cursor);}owners.set(id,'VS Code / Node');return 'VS Code / Node';};
 const totals=new Map<string,number>(),frames=new Map<string,{function:string;url:string;line:number;ms:number}>();let sampledMs=0;
 for(const [i,id]of (profile.samples||[]).entries()){const ms=Math.max(0,profile.timeDeltas?.[i]||0)/1000;sampledMs+=ms;const ext=owner(id);totals.set(ext,(totals.get(ext)||0)+ms);const frame=nodes.get(id)?.callFrame;if(frame&&frame.functionName!=='(idle)'){const key=`${frame.url}:${frame.lineNumber}:${frame.functionName}`,old=frames.get(key)||{function:frame.functionName||'(anonymous)',url:frame.url,line:frame.lineNumber+1,ms:0};old.ms+=ms;frames.set(key,old);}}
 return {durationMs:(profile.endTime-profile.startTime)/1000,sampledMs,topExtensions:[...totals].map(([id,ms])=>({id,ms,percent:sampledMs?100*ms/sampledMs:0})).sort((a,b)=>b.ms-a.ms).slice(0,15),topFrames:[...frames.values()].sort((a,b)=>b.ms-a.ms).slice(0,20)};
}
interface Host{enabled:()=>boolean;write:(text:string)=>void;save:(name:string,data:Uint8Array)=>Promise<string>;extensions:()=>ExtensionPath[]}
// In-process inspector session; no debug port or network listener is opened.
export class StartupDebug{
 private session?:Session;private timer?:ReturnType<typeof setTimeout>;private starting?:Promise<void>;private stopping?:Promise<void>;private captured=false;private started=Date.now();private sequence=0;
 constructor(private host:Host){}
 event(name:string,fields:Record<string,unknown>={}){if(!this.host.enabled())return;this.host.write('[debug] '+JSON.stringify({at:new Date().toISOString(),elapsedMs:Date.now()-this.started,pid:process.pid,sequence:++this.sequence,event:name,...fields}));}
 async measure<T>(name:string,fields:Record<string,unknown>,run:()=>PromiseLike<T>):Promise<T>{if(!this.host.enabled())return run();const started=Date.now();this.event(name+'.begin',fields);try{const result=await run();this.event(name+'.end',{...fields,durationMs:Date.now()-started});return result;}catch(e){this.event(name+'.failed',{...fields,durationMs:Date.now()-started,error:e instanceof Error?e.message:String(e)});throw e;}}
 refresh(){if(this.host.enabled())void this.start();else if(this.session)void this.stop();}
 start(){if(this.captured||this.starting||!this.host.enabled())return this.starting||Promise.resolve();this.captured=true;
  this.starting=new Promise<void>((resolve,reject)=>{try{const session=new Session();this.session=session;session.connect();const steps:[string,Record<string,unknown>][]=[['Profiler.enable',{}],['Profiler.setSamplingInterval',{interval:5000}],['Profiler.start',{}]];const next=(i:number)=>{if(i===steps.length){this.event('cpu-profile.started',{durationSeconds:30,samplingIntervalUs:5000});this.timer=setTimeout(()=>void this.stop(),30000);this.timer.unref?.();resolve();return;}const [method,params]=steps[i];(session.post as any)(method,params,(error:Error|null)=>error?reject(error):next(i+1));};next(0);}catch(e){reject(e);}}).catch(e=>{this.event('cpu-profile.unavailable',{error:String(e)});this.session?.disconnect();this.session=undefined;});return this.starting;
 }
 private post(method:string,params:Record<string,unknown>={}):Promise<any>{return new Promise((resolve,reject)=>{if(!this.session){reject(Error('Profiler session closed'));return;}(this.session.post as any)(method,params,(error:Error|null,result:any)=>error?reject(error):resolve(result));});}
 async stop(){if(this.stopping)return this.stopping;this.stopping=(async()=>{await this.starting;if(!this.session)return;clearTimeout(this.timer);try{const result=await this.post('Profiler.stop'),profile=result.profile as CpuProfile,summary=summarizeProfile(profile,this.host.extensions()),stamp=new Date().toISOString().replace(/[:.]/g,'-');const profileFile=await this.host.save(`startup-${stamp}.cpuprofile`,Buffer.from(JSON.stringify(profile)));const summaryFile=await this.host.save(`startup-${stamp}.json`,Buffer.from(JSON.stringify(summary,null,2)));this.host.write('[debug] '+JSON.stringify({event:'cpu-profile.saved',profileFile,summaryFile,...summary}));}catch(e){this.host.write('[debug] '+JSON.stringify({event:'cpu-profile.failed',error:String(e)}));}finally{this.session?.disconnect();this.session=undefined;}})().finally(()=>{this.stopping=undefined;});return this.stopping;}
 dispose(){clearTimeout(this.timer);this.session?.disconnect();this.session=undefined;}
}
