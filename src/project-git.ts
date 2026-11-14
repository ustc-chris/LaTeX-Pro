import * as fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {parseGitStatus,defaultGitignore,type GitState,type DiffView} from './git-model';
const execute=promisify(execFile);
export class ProjectGit{
 private queue:Promise<unknown>=Promise.resolve();
 constructor(private root:string){}
 private task<T>(run:()=>Promise<T>):Promise<T>{const next=this.queue.then(run,run);this.queue=next.catch(()=>{});return next;}
 private async run(args:string[],empty=false):Promise<Buffer>{
  const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('GIT_')&&!['GIT_CONFIG_GLOBAL','GIT_CONFIG_SYSTEM'].includes(key))delete env[key];env.GIT_TERMINAL_PROMPT='0';env.GIT_CEILING_DIRECTORIES=path.dirname(this.root);
  try{return (await execute('git',['-C',this.root,'--git-dir='+path.join(this.root,'.git'),'--work-tree='+this.root,'-c','core.quotePath=false',...args],{encoding:'buffer',env,timeout:30000,maxBuffer:16*1024*1024})).stdout;}catch(e:any){if(empty&&e.code===128)return Buffer.alloc(0);if(e.code==='ENOENT')throw Error('找不到 Git，请安装 Git 后重新打开版本管理');throw Error(String(e.stderr||e.message).trim().slice(0,1500));}
 }
 private async ensureImpl(){
  const root=await fs.realpath(this.root);const dot=path.join(root,'.git');let stat;try{stat=await fs.lstat(dot);}catch(e:any){if(e.code!=='ENOENT')throw e;}
  if(stat&&(!stat.isDirectory()||stat.isSymbolicLink()))throw Error('项目根目录的 .git 必须是本项目的独立仓库目录，不能指向外部仓库');
  let created=false;if(!stat){await this.run(['init','--initial-branch=main']);created=true;}
  const ignoreFile=path.join(root,'.gitignore');try{const s=await fs.lstat(ignoreFile);if(!s.isFile()||s.isSymbolicLink())throw Error('.gitignore 必须是项目内普通文件');}catch(e:any){if(e.code!=='ENOENT')throw e;await fs.writeFile(ignoreFile,defaultGitignore,{flag:'wx'});}
  if(created){await this.run(['add','-A','--','.']);await this.commitImpl('init');}
 }
 private async commitImpl(message:string){
  const name=(await this.run(['config','--get','user.name']).catch(()=>Buffer.alloc(0))).toString().trim(),email=(await this.run(['config','--get','user.email']).catch(()=>Buffer.alloc(0))).toString().trim();
  const identity=[...(!name?['-c','user.name=LaTeX Pro']:[]),...(!email?['-c','user.email=latex-pro@local.invalid']:[])];
  await this.run([...identity,'-c','commit.gpgSign=false','commit','-m',message]);
 }
 ensure(){return this.task(()=>this.ensureImpl());}
 state():Promise<GitState>{return this.task(async()=>{await this.ensureImpl();const [status,tracked,branch,head,history,ignore]=await Promise.all([this.run(['status','--porcelain=v1','-z','--untracked-files=all']),this.run(['ls-files','-z']),this.run(['symbolic-ref','--short','-q','HEAD']).catch(()=>Buffer.from('分离 HEAD')),this.run(['rev-parse','--verify','HEAD'],true),this.run(['log','-40','--format=%H%x00%h%x00%an%x00%aI%x00%s%x00'],true),fs.readFile(path.join(this.root,'.gitignore'),'utf8')]);
  const fields=history.toString().split('\0'),commits=[];for(let i=0;i+4<fields.length;i+=5){const hash=fields[i].trim();if(/^[a-f0-9]{40,64}$/.test(hash))commits.push({hash,shortHash:fields[i+1],author:fields[i+2],time:fields[i+3],subject:fields[i+4]});}
  return {available:true,root:this.root,branch:branch.toString().trim(),head:head.toString().trim(),files:parseGitStatus(status.toString()),tracked:tracked.toString().split('\0').filter(Boolean),history:commits,ignore};});}
 fileHistory(file:string){return this.task(async()=>{await this.ensureImpl();if(typeof file!=='string'||!file||file.includes('\0')||file.includes('\\')||path.isAbsolute(file)||file.split('/').includes('..')||file.startsWith('.git/'))throw Error('历史文件必须位于当前项目内');const output=await this.run(['log','--follow','-40','--format=%H%x00%h%x00%an%x00%aI%x00%s%x00','--',file],true);const fields=output.toString().split('\0'),history=[];for(let i=0;i+4<fields.length;i+=5){const hash=fields[i].trim();if(/^[a-f0-9]{40,64}$/.test(hash))history.push({hash,shortHash:fields[i+1],author:fields[i+2],time:fields[i+3],subject:fields[i+4]});}return history;});}
 commit(message:string){return this.task(async()=>{if(typeof message!=='string'||!message.trim()||message.length>500||/[\x00-\x1f]/.test(message))throw Error('请输入单行提交说明（最多 500 字）');await this.ensureImpl();if(!(await this.run(['status','--porcelain=v1','-z'])).length)throw Error('没有可提交的改动');await this.run(['add','-A','--','.']);await this.commitImpl(message.trim());});}
 saveIgnore(text:string,before:string){return this.task(async()=>{if(typeof text!=='string'||text.length>128000)throw Error('.gitignore 内容过长');await this.ensureImpl();const file=path.join(this.root,'.gitignore');if(await fs.readFile(file,'utf8')!==before)throw Error('.gitignore 已被其他程序修改，请刷新后重试');await fs.writeFile(file,text);});}
 diff(file:string,revision?:string):Promise<DiffView>{return this.task(async()=>{await this.ensureImpl();if(typeof file!=='string'||!file||file.includes('\0')||file.includes('\\')||file.split('/').includes('..')||path.isAbsolute(file)||file.startsWith('.git/'))throw Error('对比文件必须位于当前项目内');if(revision&&!/^[0-9a-f]{40,64}$/.test(revision))throw Error('版本标识无效');
  const status=parseGitStatus((await this.run(['status','--porcelain=v1','-z'])).toString()),oldPath=revision?file:status.find(f=>f.path===file)?.oldPath||file;let before:Buffer=Buffer.alloc(0);try{before=await this.run(['show',(revision||'HEAD')+':'+oldPath]);}catch(e){const exists=await this.run(['ls-tree','-z',revision||'HEAD','--',oldPath],true);if(exists.length)throw e;if(revision){const records=(await this.run(['log','--follow','--format=','--name-status','-z',revision+'..HEAD','--',file],true)).toString().split('\0');let historical=file;for(let i=0;i<records.length;){const status=records[i++].trim();if(!status)continue;const name=records[i++];if(/^[RC]/.test(status)){const destination=records[i++];if(historical===destination)historical=name;}}if(historical!==file&&(await this.run(['ls-tree','-z',revision,'--',historical],true)).length)before=await this.run(['show',revision+':'+historical]);}}
  let after:Buffer=Buffer.alloc(0);const target=path.join(this.root,file);try{const actual=await fs.realpath(target),rel=path.relative(await fs.realpath(this.root),actual);if(rel.startsWith('..'+path.sep)||path.isAbsolute(rel))throw Error('文件链接不能越出项目');const stat=await fs.stat(actual);if(stat.size>2*1024*1024)throw Error('文字对比暂支持 2 MB 以内的文件');after=await fs.readFile(actual);}catch(e:any){if(e.code!=='ENOENT')throw e;}
  if(before.length>2*1024*1024)throw Error('文字对比暂支持 2 MB 以内的文件');
  const binary=before.includes(0)||after.includes(0);let a='',b='';try{a=new TextDecoder('utf-8',{fatal:true}).decode(before);b=new TextDecoder('utf-8',{fatal:true}).decode(after);}catch{return {kind:'git',title:file,file,before:'',after:'',binary:true};}
  return {kind:'git',title:(revision?revision.slice(0,8):'当前改动')+' · '+file,file,before:a,after:b,binary};});}
}
