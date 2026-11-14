import {access,constants} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {homedir} from 'node:os';
const exec=promisify(execFile);
export interface AgentInfo{agent:AgentName;path:string;version:string;valid:boolean;error?:string}
export async function findCodex(configured=''){if(configured.trim())return configured.trim();for(const dir of [...(process.env.PATH||'').split(path.delimiter),'/opt/homebrew/bin','/usr/local/bin',path.join(homedir(),'.local/bin')]){const exe=path.join(dir,process.platform==='win32'?'codex.exe':'codex');try{await access(exe,constants.X_OK);return exe;}catch{}}throw Error('未找到 Codex，请选择可执行文件');}
export async function inspectCodex(configured=''):Promise<AgentInfo>{let exe=configured.trim();try{exe=await findCodex(exe);const {stdout,stderr}=await exec(exe,['--version'],{timeout:8000,maxBuffer:65536,windowsHide:true});const version=(stdout+'\n'+stderr).match(/\bcodex(?:-cli)?\s+v?([\d]+\.[\d]+\.[\w.+-]+)/i)?.[1];if(!version)throw Error('所选程序未返回有效的 Codex 版本');return {agent:'codex',path:exe,version,valid:true};}catch(e){return {agent:'codex',path:exe,version:'',valid:false,error:e instanceof Error?e.message:String(e)};}}

export const agentPriority=['codex','dsh','opencode','claude'] as const;
export type AgentName=typeof agentPriority[number];
export interface AgentConfiguration{name:AgentName|'';path:string;version?:string;signature?:string}
export interface DetectedAgent{agent:AgentName;path:string;version:string;signature:string;valid:boolean;cached?:boolean;error?:string}
export async function detectInstalledAgent(saved?:AgentConfiguration,force=false,dirs=[...(process.env.PATH||'').split(path.delimiter),'/opt/homebrew/bin','/usr/local/bin',path.join(homedir(),'.local/bin')],fallbackOnMissing=true):Promise<DetectedAgent|undefined>{
 const {stat}=await import('node:fs/promises');const names=saved?.path&&saved.name?[saved.name]:saved?.name?[saved.name]:agentPriority;
 for(const name of names){for(const exe of saved?.path?[saved.path]:[...new Set(dirs)].filter(Boolean).map(dir=>path.join(dir,name+(process.platform==='win32'?'.exe':'')))){try{await access(exe,constants.X_OK);const info=await stat(exe);if(!info.isFile())continue;const signature=`${info.size}:${info.mtimeMs}`;if(!force&&saved?.path===exe&&saved.signature===signature&&saved.version)return {agent:name,path:exe,signature,version:saved.version,valid:true,cached:true};const {stdout,stderr}=await exec(exe,['--version'],{timeout:2500,maxBuffer:65536,windowsHide:true});const result=(stdout+'\n'+stderr).trim(),version=result.match(/\b\d+\.\d+\.[\w.+-]+/)?.[0];const identity=name==='codex'?/codex/i:name==='claude'?/claude/i:name==='dsh'?/dsh/i:/opencode/i;if(!version||(!identity.test(result)&&!(new RegExp('^'+name+'(?:\\.exe|\\.cmd|\\.bat)?$','i').test(path.basename(exe))&&/^v?\d+\.\d+\.[\w.+-]+$/.test(result))))continue;return {agent:name,path:exe,signature,version,valid:true};}catch{}}
 }
 // A saved path may have moved: retry discovery in priority order once.
 if(saved?.path&&fallbackOnMissing)return detectInstalledAgent(undefined,force,dirs);return undefined;
}
