import {findCodex} from './agent-discovery';
import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {createInterface} from 'node:readline';
import {access,constants} from 'node:fs/promises';
import path from 'node:path';
import {homedir} from 'node:os';
export class CodexClient{
 private disposed=false;private child?:ChildProcessWithoutNullStreams;private next=0;private pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();private startTask?:Promise<void>;
 onNotification:(method:string,params:any)=>void=()=>{};
 constructor(private executable:()=>string,private log:(text:string)=>void=()=>{},private cwd?:()=>string){}
 async start(){if(this.disposed)throw Error('连接已关闭');if(this.startTask)return this.startTask;this.startTask=this.launch().catch(e=>{this.startTask=undefined;throw e;});return this.startTask;}
 private async launch(){const exe=await findCodex(this.executable());if(this.disposed)throw Error('连接已关闭');
  const child=spawn(exe,['app-server'],{stdio:'pipe',env:process.env,cwd:this.cwd?.()});this.child=child;let diagnostics='';
  const lines=createInterface({input:child.stdout});lines.on('line',line=>{try{const m=JSON.parse(line);if(m.id!==undefined&&m.method){child.stdin.write(JSON.stringify({id:m.id,error:{code:-32601,message:'此客户端仅生成候选文本，不执行交互工具请求'}})+'\n');return;}if(m.id!==undefined){const p=this.pending.get(m.id);if(p){clearTimeout(p.timer);this.pending.delete(m.id);m.error?p.reject(Error(m.error.message||'Codex 请求失败')):p.resolve(m.result);}}else if(m.method)this.onNotification(m.method,m.params);}catch(e){this.log(String(e));}});
  child.stderr.on('data',d=>{diagnostics=(diagnostics+String(d)).slice(-4000);this.log(String(d).slice(0,2000));});
  const fail=(e:Error)=>{if(this.child!==child)return;this.child=undefined;this.startTask=undefined;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(e);}this.pending.clear();this.onNotification('connection/closed',{message:e.message});};child.on('error',fail);child.on('exit',(code)=>fail(Error(`Codex 连接已结束（${code??'已停止'}）${diagnostics.includes('sqlite state runtime')?'：无法初始化 Codex 数据库，请检查本机 ~/.codex 的写入权限':'。详情见输出 → LaTeX Pro'}`)));
  await this.request('initialize',{clientInfo:{name:'latex_pro',title:'LaTeX Pro',version:'0.11.0'},capabilities:{experimentalApi:false}});child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
 }
 request(method:string,params:any={}):Promise<any>{return new Promise((resolve,reject)=>{if(!this.child||this.child.killed){reject(Error('Codex 尚未连接'));return;}const id=++this.next;const timer=setTimeout(()=>{this.pending.delete(id);reject(Error(`Codex ${method} 请求超时`));},45000);this.pending.set(id,{resolve,reject,timer});this.child.stdin.write(JSON.stringify({id,method,params})+'\n');});}
 dispose(){this.disposed=true;const child=this.child;this.child=undefined;this.startTask=undefined;child?.kill();for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('连接已关闭'));}this.pending.clear();}
}
