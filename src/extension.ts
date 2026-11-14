import {compilationPaths,toolExecution} from './compile-paths';
import {defaultTools,defaultRecipes,validateCompilation,runRecipe} from './compilation';
import {PdfArtifacts} from './pdf-artifacts';
import {buildPreviewContext,groupAt} from './preview-context';
import * as vscode from 'vscode';
import {OperationHistory,patchText,type HistoryData} from './operation-history';
import {StartupDebug} from './diagnostics';
import {startupHtml} from './startup';
import {configuredHostAffinity,planHostIsolation,removeHostIsolation} from './host-isolation';
import * as path from 'node:path';
import {renamePlan,reverseChanges,type FileChange} from './rename';
import {editorColors} from './editor-theme';
import {AiManager} from './ai';
import {detectInstalledAgent,agentPriority,type DetectedAgent as AgentInfo,type AgentConfiguration} from './agent-discovery';
import {parseBibliography,attachCitationUses,type BibEntry} from './bibliography';
import {ProjectGit} from './project-git';
import {configurationIssue,completeConfiguration,isMissingConfiguration} from './configuration';
import type {AiState} from './ai-model';
import {randomBytes} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {homedir} from 'node:os';
import * as fs from 'node:fs/promises';
import {forwardPoint,reversePoint} from './sync';
import {automaticPdf,searchDocuments} from './document';
import {scanFile, normalizeRelative, maskNonCode,updateUnit,type Unit, type Settings, type Snapshot, type ScanFile} from './model';

export function activate(context:vscode.ExtensionContext){
  const activated=Date.now();let extensionDisposed=false;
  const panelDrafts=new Map<vscode.WebviewPanel,boolean>();
  const panels=new Set<vscode.WebviewPanel>();
  let startupPanel:vscode.WebviewPanel|undefined;
  const panelTargets=new WeakMap<vscode.WebviewPanel,(doc?:vscode.TextDocument,structure?:boolean)=>Promise<void>>();
  let bound=vscode.workspace.workspaceFolders?.find(f=>f.uri.toString()===context.workspaceState.get<string>('boundRoot'));
  let files:ScanFile[]=[], issues:string[]=[],configurationIssues:string[]=[], scannedAt='', scanning=false, rescan=false;
  let nativeColors:Record<string,string>={};
  let automaticHostTask:Promise<void>|undefined;
  let backgroundStarted=false;
  const startupBuild=String(context.extension.packageJSON.version)+':'+String(context.extension.packageJSON.__metadata?.installedTimestamp||'');
  const config=()=>vscode.workspace.getConfiguration('latexPro',bound?.uri);
  const settings=():Settings=>{const c=config();const engine=c.get<string>('compiler','pdflatex'),own=(key:string)=>{const i=c.inspect(key);return i?.workspaceFolderValue!==undefined||i?.workspaceValue!==undefined||i?.globalValue!==undefined;};const tools=(own('latex.tools')?c.get<Settings['latexTools']>('latex.tools'):undefined)|| (engine==='custom'?[{name:'custom',command:c.get('compilerCommand',''),args:c.get<string[]>('compilerArgs',[]).map(a=>a.replaceAll('%DOC%','%DOC_EXT%')),env:{}}]:defaultTools);const recipes=(own('latex.recipes')?c.get<Settings['latexRecipes']>('latex.recipes'):undefined)||(engine==='custom'?[{name:'自定义',tools:['custom']}]:defaultRecipes);const preferred=engine==='custom'?'自定义':engine==='xelatex'?'latexmk · XeLaTeX':engine==='lualatex'?'latexmk · LuaLaTeX':'latexmk · PDFLaTeX',fallbackRecipe=Array.isArray(recipes)&&!recipes.some(r=>r?.name===preferred)?recipes[0]?.name||preferred:preferred;return {latexTools:tools,latexRecipes:recipes,latexRecipe:own('latex.recipe.default')?c.get('latex.recipe.default',fallbackRecipe):fallbackRecipe,latexOutDir:c.get('latex.outDir','.'),agent:c.get<AgentConfiguration>('agent'),aiAgent:c.get('aiAgent','codex'),aiPrompt:c.get('aiPrompt',''),historyLimit:c.get('historyLimit',335),projectName:c.get('projectName',''),mainFile:c.get('mainFile',''),pdfFile:c.get('mainFile','')?path.posix.join(c.get('latex.outDir','.'),automaticPdf(c.get('mainFile',''))):'',autoScan:c.get('autoScan',true),fontSize:vscode.workspace.getConfiguration('editor',{uri:bound?.uri,languageId:'latex'}).get('fontSize',14),wordWrap:c.get('wordWrap',true),defaultLayout:c.get('defaultLayout','source'),previewWidth:c.get('previewWidth',760),previewFontSize:c.get('previewFontSize',16),defaultView:c.get('defaultView','work'),debug:c.get('debug',false),compiler:c.get('compiler','pdflatex'),theme:c.get('theme','system'),aiCodexPath:c.get('aiCodexPath',''),compilerCommand:c.get('compilerCommand',''),compilerArgs:c.get('compilerArgs',['-synctex=1','-interaction=nonstopmode','%DOC%']),editorTheme:nativeColors,editorFontFamily:vscode.workspace.getConfiguration('editor',{uri:bound?.uri,languageId:'latex'}).get('fontFamily','monospace')};};
  const relative=(uri:vscode.Uri)=>bound?path.relative(bound.uri.fsPath,uri.fsPath).split(path.sep).join('/'):uri.fsPath;
  const output=vscode.window.createOutputChannel('LaTeX Pro');context.subscriptions.push(output);
  const debug=new StartupDebug({enabled:()=>config().get('debug',false),write:line=>output.appendLine(line),extensions:()=>vscode.extensions.all.map(e=>({id:e.id,path:e.extensionPath})),save:async(name,data)=>{await vscode.workspace.fs.createDirectory(context.logUri);const uri=vscode.Uri.joinPath(context.logUri,name);await vscode.workspace.fs.writeFile(uri,data);return uri.fsPath;}});context.subscriptions.push(debug);debug.event('activate.begin',{version:context.extension.packageJSON.version,debug:config().get('debug',false)});debug.refresh();
  const timings:{name:string;ms:number;at:string;clientMs?:number;durationMs?:number}[]=[];
  function timing(name:string,ms:number,clientMs?:number,durationMs?:number){const at=new Date().toISOString();timings.push({name,ms,at,...(clientMs===undefined?{}:{clientMs}),...(durationMs===undefined?{}:{durationMs})});if(timings.length>100)timings.shift();output.appendLine(`[${at}] ${name}: ${ms}ms${clientMs===undefined?'':` · 页面时间 ${clientMs}ms`}${durationMs===undefined?'':` · 组件加载 ${durationMs}ms`}`);}
  output.appendLine(`[startup] version=${context.extension.packageJSON.version} host=${process.pid} configuredAffinity=${configuredHostAffinity(vscode.workspace.getConfiguration('extensions').get('experimental.affinity',{}))}`);
  // Measure shared-host stalls separately from page/Monaco loading. Stop after startup.
  let lagTimer:ReturnType<typeof setTimeout>|undefined,lagStopped=false,lastTick=Date.now();
  const watchLag=()=>{if(lagStopped)return;const now=Date.now(),lag=now-lastTick-500;lastTick=now;if(lag>1000)timing('extension host blocked',lag);lagTimer=setTimeout(watchLag,500);lagTimer.unref?.();};
  lagTimer=setTimeout(watchLag,500);lagTimer.unref?.();
  const stopLag=setTimeout(()=>{lagStopped=true;clearTimeout(lagTimer);},30000);stopLag.unref?.();
  context.subscriptions.push({dispose:()=>{lagStopped=true;clearTimeout(lagTimer);clearTimeout(stopLag);}});

  // Project reads must not open hundreds of invisible VS Code documents.
  async function readText(uri:vscode.Uri){const open=vscode.workspace.textDocuments.find(d=>!d.isClosed&&d.uri.toString()===uri.toString());return open?open.getText():new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));}
  async function projectUri(rel:string){
    if(!bound)throw Error('请先绑定当前项目');
    const normalized=normalizeRelative(rel); if(!normalized)throw Error('请选择文件');
    const uri=vscode.Uri.joinPath(bound.uri,normalized);
    // Reject symlinks escaping the bound workspace.
    if(uri.scheme==='file'){
      const [realRoot,realFile]=await Promise.all([fs.realpath(bound.uri.fsPath),fs.realpath(uri.fsPath)]);
      const r=path.relative(realRoot,realFile);if(r.startsWith('..'+path.sep)||r==='..'||path.isAbsolute(r))throw Error('文件必须位于绑定项目内');
    }
    return uri;
  }
  function snapshot():Snapshot{return {bound:!!bound,project:settings().projectName||bound?.name||'',files,settings:settings(),mainFile:settings().mainFile,scannedAt,issues:[...configurationIssues,...issues]};}
  function broadcast(){const data=snapshot();debug.event('snapshot.broadcast',{panels:panels.size,files:data.files.length,units:data.files.reduce((n,f)=>n+f.units.length,0)});for(const p of panels)void p.webview.postMessage({type:'snapshot',snapshot:data});}
  let ai:AiManager|undefined;
  function getAI(){if(settings().agent?.name&&settings().agent?.name!=='codex')throw Error('已识别 '+settings().agent!.name+'，本版本暂未接入其会话协议');if(!bound)throw Error('请先绑定项目');if(!ai){ai=new AiManager({root:()=>bound!.uri.fsPath,executable:()=>settings().agent?.path||settings().aiCodexPath||'',prompt:()=>settings().aiPrompt||'',read:async file=>readText(await projectUri(file)),persist:async state=>{await context.workspaceState.update('ai.v4',state);},changed:state=>{for(const p of panels)void p.webview.postMessage({type:'aiState',state});},log:line=>output.appendLine(line)},context.workspaceState.get<AiState>('ai.v4'));}return ai;}
  type Change=FileChange;
  const journals=new Map<string,OperationHistory>();
  const journalKey=()=>`history.v1:${bound?.uri.toString()||''}`;
  function journal(){const key=journalKey();if(!journals.has(key))journals.set(key,new OperationHistory(context.workspaceState.get<HistoryData>(key),settings().historyLimit));const j=journals.get(key)!;j.limit=settings().historyLimit||335;j.trim();return j;}
  const historyState=()=>{const data=journal().data;for(const p of panels)void p.webview.postMessage({type:'historyState',undo:data.undo.length,redo:data.redo.length});};
  async function persistHistory(){await context.workspaceState.update(journalKey(),journal().data);historyState();}
  const recentWrites=new Map<string,{before:string;after:string}>();
  const knownMapDrafts=new Set<string>((context.workspaceState.keys?.()||[]).filter(k=>k.startsWith('mapDraft:')));
  const findUnit=(file:string,text:string,id:string)=>{const p=scanFile(file,text);return [...p.units,...(p.structuralHeadings||[])].find(u=>u.id===id);};
  async function projectText(file:string){const uri=await projectUri(file),disk=await readText(uri),draft=context.workspaceState.get<{text:string;base:string}>(`draft:${uri.toString()}`);if(draft)return {uri,disk,text:draft.text,base:draft.base};let text=disk;const prefix=`mapDraft:${file}:`,parts:{start:number;end:number;text:string}[]=[];for(const key of knownMapDrafts){if(!key.startsWith(prefix))continue;const d=context.workspaceState.get<{text:string;base:string}>(key),u=findUnit(file,disk,key.slice(prefix.length));if(d&&u&&disk.slice(u.start,u.end)===d.base)parts.push({start:u.start,end:u.end,text:d.text});}for(const p of parts.sort((a,b)=>b.start-a.start))text=text.slice(0,p.start)+p.text+text.slice(p.end);return {uri,disk,text,base:disk};}
  async function writeProjectDraft(file:string,text:string,base:string,id?:string,exclude?:vscode.WebviewPanel,origin:'work'|'map'='map'){const uri=await projectUri(file);await context.workspaceState.update(`draft:${uri.toString()}`,text===base?undefined:{text,base});if(id)knownMapDrafts.add(`mapDraft:${file}:${id}`);const prefix=`mapDraft:${file}:`;for(const key of knownMapDrafts){if(!key.startsWith(prefix))continue;const unitId=key.slice(prefix.length),b=findUnit(file,base,unitId),t=findUnit(file,text,unitId);if(b&&t){const before=base.slice(b.start,b.end),after=text.slice(t.start,t.end);await context.workspaceState.update(key,after===before?undefined:{text:after,base:before});}}for(const p of panels)void p.webview.postMessage({type:'draftSync',file,text,base,version:vscode.workspace.textDocuments.find(d=>!d.isClosed&&d.uri.toString()===uri.toString())?.version,skipMap:p===exclude&&origin==='map',skipMapId:p===exclude&&origin==='map'?id:undefined,skipWork:p===exclude&&origin==='work'});}
  async function recordDraft(kind:'work'|'map',file:string,id:string|undefined,text:string,base:string,exclude?:vscode.WebviewPanel){const state=await projectText(file),ownWrite=recentWrites.get(file);if(kind==='map'){if(ownWrite&&ownWrite.after===state.disk){const old=findUnit(file,ownWrite.before,id!),now=findUnit(file,state.disk,id!);if(old&&now&&ownWrite.before.slice(old.start,old.end)===base)base=state.disk.slice(now.start,now.end);}if(!id?.startsWith('file:')&&base.endsWith('\n')&&!text.endsWith('\n'))text+='\n';knownMapDrafts.add(`mapDraft:${file}:${id}`);const unit=findUnit(file,state.text,id!),diskUnit=findUnit(file,state.disk,id!);if(!unit||!diskUnit||state.base!==state.disk||state.disk.slice(diskUnit.start,diskUnit.end)!==base){await context.workspaceState.update(`mapDraft:${file}:${id}`,{text,base});throw Error('原文已变化，地图草稿已保留，请核对后再继续');}const before=state.text.slice(unit.start,unit.end);journal().record(kind,[{file,id,before,after:text}]);await writeProjectDraft(file,state.text.slice(0,unit.start)+text+state.text.slice(unit.end),state.disk,id,exclude);
    }else{if(ownWrite?.before===base&&ownWrite.after===state.disk)base=state.disk;journal().record(kind,[{file,...(id?{id}:{}),before:state.text,after:text}]);await writeProjectDraft(file,text,base,undefined,exclude,'work');}await persistHistory();}
  let mutationQueue=Promise.resolve();
  async function applyChanges(changes:Change[],record=false,aiChange=false){
    if(record)for(const c of changes){const uri=await projectUri(c.file);if(context.workspaceState.get(`draft:${uri.toString()}`))throw Error('目标文件有未保存草稿，请先保存后再应用文件操作');}
    const edit=new vscode.WorkspaceEdit(),uris:vscode.Uri[]=[];
    for(const c of changes){const uri=await projectUri(c.file),doc=await vscode.workspace.openTextDocument(uri);if(doc.getText()!==c.before)throw Error('文件已改变，请重新查看差异后再应用');edit.replace(uri,new vscode.Range(doc.positionAt(0),doc.positionAt(c.before.length)),c.after);let target=uri;if(c.renameTo){const name=normalizeRelative(c.renameTo);if(path.posix.dirname(name)!==path.posix.dirname(c.file)||!name.endsWith('.tex'))throw Error('只能在同一目录重命名 TeX 文件');target=vscode.Uri.joinPath(bound!.uri,name);const exists=await vscode.workspace.fs.stat(target).then(()=>true,()=>false);if(exists)throw Error('目标文件已存在');edit.renameFile(uri,target,{overwrite:false});}uris.push(target);}
    if(!await vscode.workspace.applyEdit(edit))throw Error('无法应用修改');
    for(const uri of uris)if(!await (await vscode.workspace.openTextDocument(uri)).save())throw Error('保存失败，修改仍保留在编辑器中');
    for(const c of changes)if(c.renameTo&&settings().mainFile===c.file)await saveSetting('mainFile',c.renameTo);
    for(const c of changes)recentWrites.set(c.renameTo||c.file,{before:c.before,after:c.after});
    if(record){journal().record('disk',changes,aiChange);await persistHistory();}
  }
  let projectGit:ProjectGit|undefined,gitRoot='';
  function getGit(){if(!bound||bound.uri.scheme!=='file')throw Error('版本管理需要绑定本地项目');if(gitRoot!==bound.uri.fsPath){gitRoot=bound.uri.fsPath;projectGit=new ProjectGit(gitRoot);}return projectGit!;}
  async function refreshGit(){const state=await getGit().state();for(const p of panels)void p.webview.postMessage({type:'gitState',state});}
  async function settingTarget(){if(bound){try{await vscode.workspace.fs.stat(vscode.Uri.joinPath(bound.uri,'.vscode','settings.json'));return vscode.ConfigurationTarget.WorkspaceFolder??vscode.ConfigurationTarget.Workspace;}catch(e){if(!isMissingConfiguration(e))throw e;}}return vscode.ConfigurationTarget.Global;}
  const settingName=(key:string)=>({latexTools:'latex.tools',latexRecipes:'latex.recipes',latexRecipe:'latex.recipe.default',latexOutDir:'latex.outDir'} as Record<string,string>)[key]||key;
  async function saveSetting(key:string,value:unknown){await config().update(settingName(key),value,await settingTarget());}
  let checkingConfiguration=false;
  async function checkProjectConfiguration(){if(!bound||checkingConfiguration)return;checkingConfiguration=true;const uri=vscode.Uri.joinPath(bound.uri,'.vscode','settings.json');try{const original=new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)),issue=configurationIssue(original,uri.fsPath);configurationIssues=issue?[issue]:[];if(!issue){const {pdfFile,editorTheme,editorFontFamily,...values}=settings(),next=completeConfiguration(original,values);if(next!==original)await vscode.workspace.fs.writeFile(uri,new TextEncoder().encode(next));}}catch(e:any){configurationIssues=isMissingConfiguration(e)?[]:[`无法读取项目配置 ${uri.fsPath}：${e.message||e}`];}finally{checkingConfiguration=false;}broadcast();}
  let agentInfo:AgentInfo|undefined;
  let compilationInitialized:Promise<void>|undefined;
  function ensureCompilationConfig(){if(!compilationInitialized)compilationInitialized=(async()=>{const cfg=settings();validateCompilation(cfg.latexTools!,cfg.latexRecipes!);for(const [key,value]of Object.entries({latexTools:cfg.latexTools,latexRecipes:cfg.latexRecipes,latexRecipe:cfg.latexRecipe,latexOutDir:cfg.latexOutDir})){const info=config().inspect(settingName(key));if(info?.workspaceFolderValue===undefined&&info?.workspaceValue===undefined&&info?.globalValue===undefined)await saveSetting(key,value);}})().catch(e=>{compilationInitialized=undefined;output.appendLine('编译配置初始化：'+String(e));});return compilationInitialized;}
  let detectingAgent:Promise<AgentInfo|undefined>|undefined;
  function detectAgent(executable?:string,connect=true,force=false,name?:AgentConfiguration['name']){if(detectingAgent)return detectingAgent;const warming=setTimeout(()=>{for(const p of panels)void p.webview.postMessage({type:'pdfWarmReady'});},1000);detectingAgent=(async()=>{const started=Date.now(),saved=(settings().agent?.name||settings().agent?.path?settings().agent:undefined)||(settings().aiCodexPath?{name:'codex' as const,path:settings().aiCodexPath!}:undefined);const negative=context.globalState?.get<boolean>('agent.discovery.empty');if(!force&&!executable&&!saved?.path&&negative){agentInfo={agent:'codex',path:'',version:'',signature:'',valid:false,cached:true,error:'未找到可用 Agent，可手动选择或重新检测'};for(const p of panels)void p.webview.postMessage({type:'agentInfo',info:agentInfo});return agentInfo;}agentInfo=await detectInstalledAgent(executable?{name:name??saved?.name??'',path:executable}:name!==undefined?{name,path:''}:saved,force,undefined,!executable);debug.event('agent.discovery',{durationMs:Date.now()-started,agent:agentInfo?.agent,cached:agentInfo?.cached});if(extensionDisposed)return agentInfo;if(agentInfo){const previousAI=ai?.state||context.workspaceState.get<AiState>('ai.v4')||{connected:false,models:[],sessions:[],requirements:[]};if(ai&&agentInfo.path!==(saved?.path||'') ){ai.dispose();ai=undefined;}const value={name:agentInfo.agent,path:agentInfo.path,version:agentInfo.version,signature:agentInfo.signature};if(JSON.stringify(settings().agent)!==JSON.stringify(value)){await saveSetting('agent',value);broadcast();}await context.globalState?.update('agent.discovery.empty',undefined);for(const p of panels)void p.webview.postMessage({type:'agentInfo',info:agentInfo});if(agentInfo.agent!=='codex'){ai?.dispose();ai=undefined;for(const p of panels)void p.webview.postMessage({type:'aiState',state:{...previousAI,connected:false,models:[],defaultModel:undefined,account:undefined}});}if(agentInfo.agent==='codex'&&connect)void getAI().connect().catch(e=>{output.appendLine('AI 后台连接：'+String(e));for(const p of panels)void p.webview.postMessage({type:'agentConnectionError',message:String(e)});});}else{await context.globalState?.update('agent.discovery.empty',true);for(const p of panels)void p.webview.postMessage({type:'agentInfo',info:{valid:false,agent:'codex',path:'',version:'',error:'未找到可用 Agent，可手动选择或重新检测'}});}return agentInfo;})().finally(()=>{clearTimeout(warming);detectingAgent=undefined;for(const p of panels)void p.webview.postMessage({type:'pdfWarmReady'});});return detectingAgent;}
  const pdfStorage=context.globalStorageUri?vscode.Uri.joinPath(context.globalStorageUri,'pdf-artifacts'):undefined;
  const pdfArtifacts=pdfStorage?new PdfArtifacts(pdfStorage.fsPath):undefined;
  void pdfArtifacts?.prune().catch(e=>output.appendLine('PDF 缓存清理：'+String(e)));

  async function scan(){
    if(!bound)return; if(scanning){rescan=true;return;}scanning=true;
    const started=Date.now();
    try{
      const uris=await debug.measure('scan.findFiles',{},()=>vscode.workspace.findFiles(new vscode.RelativePattern(bound!,'**/*.tex'),'**/{node_modules,.git,dist,build,out}/**',2001));
      if(uris.length>2000)throw Error('第一版最多扫描 2000 个 .tex 文件，请缩小项目范围');
      const next:ScanFile[]=[];const errors:string[]=[];
      const sorted=uris.sort((a,b)=>a.path.localeCompare(b.path));
      for(let batch=0;batch<sorted.length;batch+=8){await Promise.all(sorted.slice(batch,batch+8).map(async uri=>{
        try{await projectUri(relative(uri));const stat=await vscode.workspace.fs.stat(uri);if(stat.size>2*1024*1024){errors.push(`${relative(uri)} 超过 2 MB，已跳过`);return;}const rel=relative(uri);next.push(await debug.measure('scan.file',{file:rel,bytes:stat.size},async()=>{const state=await projectText(rel);return scanFile(rel,state.base===state.disk?state.text:state.disk);}));}catch(e){errors.push(String(e));}
      }));}next.sort((a,b)=>a.path.localeCompare(b.path));
      const ids=new Set<string>();for(const f of next)for(const u of f.units)if(u.kind==='fragment'){if(ids.has(u.id))errors.push(`片段 ID 跨文件重复：${u.id}`);ids.add(u.id);}
      files=next;issues=[...errors,...next.flatMap(f=>f.issues)];scannedAt=new Date().toISOString();void context.workspaceState.update('scanCache.v3',files);broadcast();
    }finally{timing(`scan (${files.length} files)`,Date.now()-started);scanning=false;if(rescan){rescan=false;void scan().catch(report);}}
  }
  function report(e:unknown){void vscode.window.showErrorMessage(`LaTeX Pro：${e instanceof Error?e.message:String(e)}`);}
  async function bind(){
    const roots=vscode.workspace.workspaceFolders;
    if(!roots?.length){void vscode.window.showInformationMessage('请先在 VS Code 中打开一个项目文件夹。当前仅支持代码查看。');return;}
    if(roots.length!==1)throw Error('第一版请使用单文件夹工作区');
    bound=roots[0];await checkProjectConfiguration();await context.workspaceState.update('boundRoot',bound.uri.toString());await ensureAutomaticHostIsolation();await scan();
    if(!settings().mainFile){const candidate=files.find(f=>f.path==='main.tex')||files[0];if(candidate)await saveSetting('mainFile',candidate.path);}
    broadcast();await refreshGit().catch(report);
  }
  async function fullText(){
    const visited=new Set<string>();
    async function expand(rel:string):Promise<string>{
      const uri=await projectUri(rel);const key=relative(uri);if(visited.has(key))return `% 已包含：${key}\n`;visited.add(key);
      const raw=await readText(uri);
      const text=raw.replace(/\\includegraphics(\[[^\]]*\])?\{([^}]+)\}/g,(_m,options,name)=>{try{return `\\includegraphics${options||''}{${normalizeRelative(path.posix.join(path.posix.dirname(key),name))}}`;}catch{return _m;}});
      const refs=[...maskNonCode(text).matchAll(/\\(?:input|include)\s*\{([^}]+)\}/g)];let out='',last=0;
      for(const m of refs){out+=text.slice(last,m.index);const name=m[1].endsWith('.tex')?m[1]:m[1]+'.tex';const candidate=normalizeRelative(path.posix.join(path.posix.dirname(key),name));
        try{out+=`\n% ── ${candidate} ──\n`+await expand(candidate);}catch{try{out+=await expand(normalizeRelative(name));}catch{out+=m[0];}}
        last=m.index!+m[0].length;
      }return out+text.slice(last);
    }
    if(!settings().mainFile)throw Error('请在设置中选择主入口文件');return expand(settings().mainFile);
  }
  const toolCache=new Map<string,string>();
  async function runTool(name:string,args:string[],environment:Record<string,string>={},cwd=bound?.uri.fsPath){
    const cacheKey=name+'\0'+(environment.PATH||'');let exe=toolCache.get(cacheKey);if(path.isAbsolute(name))exe=name;else if(name.includes('/')||name.includes(path.sep))exe=path.resolve(bound?.uri.fsPath||'.',name);if(!exe){const folders=[...(environment.PATH??process.env.PATH??'').split(path.delimiter),'/Library/TeX/texbin'];for(const root of [path.join(homedir(),'Softwares/texlive'),'/usr/local/texlive']){try{for(const year of (await fs.readdir(root)).sort().reverse())folders.push(path.join(root,year,'bin','universal-darwin'),path.join(root,year,'bin','x86_64-linux'));}catch{}}
      for(const folder of folders){const candidate=path.join(folder,name);try{await fs.access(candidate,fs.constants.X_OK);exe=candidate;break;}catch{}}if(!exe)throw Error(`找不到 ${name}，请安装 TeX Live 或配置 PATH`);toolCache.set(cacheKey,exe);}
    return await promisify(execFile)(exe,args,{cwd,timeout:120000,maxBuffer:4*1024*1024,env:{...process.env,PATH:path.dirname(exe)+path.delimiter+(process.env.PATH||''),...environment}});
  }
  let compileBusy=false;let compileState={running:false,recipe:'',output:'',error:''};const compilePublish=()=>{for(const p of panels)void p.webview.postMessage({type:'compileState',state:compileState});};
  function openPanel(document?:vscode.TextDocument,structure=false,existing?:vscode.WebviewPanel,initialUnit?:string,initialPreview=false){
    const started=Date.now();debug.event('panel.create.begin',{structure,customEditor:!!existing,file:document?relative(document.uri):undefined});
    const panel=existing||vscode.window.createWebviewPanel('latexPro.workbench','LaTeX Pro',vscode.ViewColumn.Active,{enableScripts:true,retainContextWhenHidden:true});
    debug.event('panel.create.end',{durationMs:Date.now()-started});panels.add(panel);let currentUri=document?.uri;let contentTicket=0,disposed=false;let lastSent:{uri:string;version:number;text:string}|undefined;let initialStructure=structure;let displayed=false;
    panelTargets.set(panel,async(doc,structure=false)=>{initialStructure=structure;if(doc&&doc.uri.toString()!==currentUri?.toString()){currentUri=doc.uri;await content(true);}if(structure)await web.postMessage({type:'structureFocus'});});
    const updateActive=()=>void vscode.commands.executeCommand('setContext','latexPro.active',[...panels].some(p=>p.active));
    panel.onDidChangeViewState(updateActive);updateActive();
    panel.webview.options={enableScripts:true,localResourceRoots:[vscode.Uri.joinPath(context.extensionUri,'dist'),...(vscode.workspace.workspaceFolders||[]).map(f=>f.uri),...(pdfStorage?[pdfStorage]:[])]};
    const web=panel.webview;const asset=(p:string)=>web.asWebviewUri(vscode.Uri.joinPath(context.extensionUri,'dist',p)).toString();const nonce=randomBytes(18).toString('hex');
    web.html=startupHtml({nonce,cspSource:web.cspSource,css:asset('webview.css'),script:asset('webview.js'),assets:{worker:asset('pdf.worker.mjs'),cmaps:asset('cmaps/'),fonts:asset('standard_fonts/'),wasm:asset('wasm/'),version:context.extension.packageJSON.version,debug:config().get('debug',false)},firstStart:context.globalState?.get<string>('startup.initializedBuild')!==startupBuild});
    debug.event('panel.html.assigned',{durationMs:Date.now()-started});
    async function content(recover=false,requestId?:number){const uri=currentUri,ticket=++contentTicket;if(!uri||disposed)return;const doc=await debug.measure('content.openDocument',{file:relative(uri)},()=>vscode.workspace.openTextDocument(uri));if(disposed||ticket!==contentTicket||uri.toString()!==currentUri?.toString())return;const text=doc.getText(),draft=recover&&bound?await projectText(relative(uri)):undefined;lastSent={uri:uri.toString(),text,version:doc.version};if(draft&&draft.text!==text)panelDrafts.set(panel,true);debug.event('content.send',{file:relative(uri),chars:text.length,recovered:!!draft});await web.postMessage({type:'content',requestId,file:relative(uri),text,version:doc.version,uri:uri.toString(),initialUnit,initialPreview,readonly:!bound||vscode.workspace.getWorkspaceFolder(uri)?.uri.toString()!==bound.uri.toString(),recoveredText:draft&&draft.text!==text?draft.text:undefined,recoveryConflict:!!draft&&draft.base!==text});}
    const changes=vscode.workspace.onDidChangeTextDocument(e=>{if(currentUri&&e.document.uri.toString()===currentUri.toString()&&!e.document.isClosed)void content().catch(report);});
    const renamed=vscode.workspace.onDidRenameFiles(e=>{for(const f of e.files)if(currentUri?.toString()===f.oldUri.toString()){currentUri=f.newUri;void web.postMessage({type:'fileRenamed',from:relative(f.oldUri),to:relative(f.newUri)});void content().catch(report);}});
    panel.onDidDispose(()=>{renamed.dispose();disposed=true;++contentTicket;panels.delete(panel);panelDrafts.delete(panel);if(startupPanel===panel)startupPanel=undefined;changes.dispose();updateActive();});
    web.onDidReceiveMessage(async m=>{let release:(()=>void)|undefined;if(['projectRead','projectDraft','projectSave','projectDiscard','settings','draft','unitDraft','save','unitSave','history','unitPatch','renameFile','bibSave','aiCandidate','aiApplyBatch','discardDraft'].includes(m.type)){const previous=mutationQueue;mutationQueue=new Promise<void>(resolve=>{release=resolve;});await previous;}const messageStarted=Date.now();if(!['draft','performance','debug'].includes(m.type))debug.event('message.received',{type:m.type});try{
      switch(m.type){
        case 'debug':if(typeof m.event==='string')debug.event('webview.'+m.event.slice(0,80),{clientMs:m.clientMs,details:m.details});break;
        case 'shellPainted':timing('startup shell painted',Date.now()-started,m.clientMs);break;
        case 'startupError':throw Error(`无法载入${String(m.resource).slice(0,30)}，请重新安装 LaTeX Pro 后再试`);
        case 'appDisplayed':if(displayed||disposed)break;displayed=true;if(startupPanel===panel)startupPanel=undefined;timing('workbench displayed',Date.now()-started,m.clientMs);await context.globalState?.update('startup.initializedBuild',startupBuild);startBackground();if(bound&&!scannedAt)setTimeout(()=>void scan().catch(report),0);if(bound)setTimeout(()=>{if(!disposed&&bound){try{void web.postMessage({type:'aiState',state:getAI().state});}catch{}}},0);break;
        case 'ready':if(typeof m.file==='string'&&m.file&&bound){try{currentUri=await projectUri(m.file);}catch{}}timing('webview ready',Date.now()-started,Number.isFinite(m.clientMs)?m.clientMs:undefined);await web.postMessage({type:'startupStage',message:'正在读取项目结构…'});await web.postMessage({type:'snapshot',snapshot:snapshot(),structure:initialStructure});initialStructure=false;await web.postMessage({type:'startupStage',message:'正在打开当前文档…'});await content(true);historyState();await web.postMessage({type:'debugConfig',enabled:config().get('debug',false)});initialUnit=undefined;initialPreview=false;if(agentInfo)await web.postMessage({type:'agentInfo',info:agentInfo});await web.postMessage({type:'compileState',state:compileState});await web.postMessage({type:'startupComplete'});if(backgroundStarted&&!detectingAgent)await web.postMessage({type:'pdfWarmReady'});break;
        case 'performance':timing(String(m.name).slice(0,60),Date.now()-started,Number.isFinite(m.clientMs)?m.clientMs:undefined,Number.isFinite(m.durationMs)?m.durationMs:undefined);break;
        case 'bind':await bind();await content(true);if(!settings().agent?.name||settings().agent?.name==='codex')await web.postMessage({type:'aiState',state:getAI().state});void detectAgent().catch(e=>output.appendLine(String(e)));break;
        case 'scan':await scan();break;
        case 'mapFileRead':{const state=await projectText(m.file);await web.postMessage({type:'mapFileContent',requestId:m.requestId,file:m.file,text:state.text,base:state.disk,revision:m.revision});break;}
        case 'unitRead':{const state=await projectText(m.file),unit=findUnit(m.file,state.disk,m.id),edited=findUnit(m.file,state.text,m.id);if(!unit)throw Error('内容已改变，请刷新地图');const source=state.disk.slice(unit.start,unit.end),draft=edited?state.text.slice(edited.start,edited.end):source,stored=context.workspaceState.get<{text:string;base:string}>(`mapDraft:${m.file}:${m.id}`),recovery=stored&&stored.base!==source?stored:draft!==source?{text:draft,base:state.base===state.disk?source:''}:undefined;await web.postMessage({type:'unitContent',requestId:m.requestId,file:m.file,id:m.id,text:source,recovery});break;}
        case 'unitDraft':{if(typeof m.text!=='string'||typeof m.base!=='string'||m.text.length>2*1024*1024)throw Error('地图草稿无效');await projectUri(m.file);await recordDraft('map',m.file,m.id,m.text,m.base,panel);break;}
        case 'unitSave':{if(typeof m.text==='string'&&!String(m.id).startsWith('file:')&&String(m.before).endsWith('\n')&&!m.text.endsWith('\n'))m.text+='\n';const state=await projectText(m.file),doc=await vscode.workspace.openTextDocument(state.uri);if(doc.isDirty)throw Error('原生编辑器有未保存的修改，请先保存后再写回地图内容');const unit=findUnit(m.file,state.disk,m.id);if(state.base!==state.disk||!unit||state.disk.slice(unit.start,unit.end)!==m.before)throw Error('原文已改变，地图草稿已保留，请重新核对');if(typeof m.text!=='string'||m.text.length>2*1024*1024)throw Error('内容超过 2 MB');await recordDraft('map',m.file,m.id,m.text,m.before,panel);const edited=await projectText(m.file),after=state.disk.slice(0,unit.start)+m.text+state.disk.slice(unit.end);await applyChanges([{file:m.file,before:state.disk,after}]);journal().markSaved('map',m.file,m.id);await persistHistory();await writeProjectDraft(m.file,edited.text,after,m.id,panel);await web.postMessage({type:'unitSaved',requestId:m.requestId,file:m.file,id:m.id,text:m.text});await scan();break;}
        case 'bibliography':{if(!bound)break;const uris=await vscode.workspace.findFiles(new vscode.RelativePattern(bound,'**/*.bib'),'**/{node_modules,.git,dist,build,out}/**',501);if(uris.length>500)throw Error('参考文献文件超过 500 个，请缩小项目范围');const entries:BibEntry[]=[],messages:string[]=[];const docs=await Promise.all(files.map(async f=>({file:f.path,text:await readText(await projectUri(f.path))})));const available=new Set(uris.map(relative)),declared=new Set<string>();for(const doc of docs)for(const match of maskNonCode(doc.text).matchAll(/\\(?:bibliography|addbibresource)(?:\[[^\]]*\])?\{([^}]+)\}/g))for(const name of match[1].split(',').map(n=>n.trim())){if(!name||name.includes('\\'))continue;try{const withExt=name.endsWith('.bib')?name:name+'.bib',rooted=normalizeRelative(withExt),nested=normalizeRelative(path.posix.join(path.posix.dirname(doc.file),withExt)),file=available.has(rooted)?rooted:nested;declared.add(file);if(!available.has(file))messages.push('找不到声明的文献文件：'+file);}catch{messages.push('文献路径不在当前项目内：'+name);}}let total=0;for(const uri of uris){if(declared.size&&!declared.has(relative(uri)))continue;await projectUri(relative(uri));const stat=await vscode.workspace.fs.stat(uri);total+=stat.size;if(stat.size>2*1024*1024||total>20*1024*1024){messages.push(relative(uri)+' 超过文献读取限制，已跳过');continue;}const result=parseBibliography(relative(uri),await readText(uri));entries.push(...result.entries);messages.push(...result.issues);}attachCitationUses(entries,docs);const keys=new Set<string>();for(const entry of entries){if(keys.has(entry.key))messages.push('重复引用键：'+entry.key);keys.add(entry.key);}await web.postMessage({type:'bibliography',entries,issues:messages});break;}
        case 'bibSave':{const uri=await projectUri(m.file);if(!m.file.endsWith('.bib')||typeof m.before!=='string'||typeof m.text!=='string'||m.text.length>2*1024*1024)throw Error('BibTeX 内容无效');const text=await readText(uri),start=Number(m.start);if(!Number.isInteger(start)||start<0||text.slice(start,start+m.before.length)!==m.before)throw Error('文献原文已改变，请刷新后重新编辑');const parsed=parseBibliography(m.file,m.text);if(parsed.issues.length||parsed.entries.length!==1)throw Error('请输入一条完整有效的 BibTeX 文献');await applyChanges([{file:m.file,before:text,after:text.slice(0,start)+m.text+text.slice(start+m.before.length)}],true);await web.postMessage({type:'bibliographySaved'});break;}
        case 'open':{const uri=await projectUri(m.file);currentUri=uri;panel.title=`LaTeX Pro · ${path.basename(m.file)}`;await content(true,m.requestId);break;}
        case 'newTab':{const doc=await vscode.workspace.openTextDocument(await projectUri(m.file));await openPanel(doc,false,undefined,m.id,m.preview===true);break;}
        case 'renameFile':{const docs=await Promise.all(files.map(async f=>({file:f.path,text:await readText(await projectUri(f.path))})));const changes=renamePlan(docs,m.file,m.name);await applyChanges(changes,true);await scan();break;}
        case 'unitPatch':{const uri=await projectUri(m.file);const doc=await vscode.workspace.openTextDocument(uri);const patch=m.patch;if(!patch||Object.keys(patch).some(k=>!['title','status','tag','time'].includes(k))||Object.values(patch).some(v=>typeof v!=='string'||v.length>500))throw Error('元数据无效');const state=await projectText(m.file);if(state.text!==state.disk&&patch.title===undefined){if(state.base!==state.disk)throw Error('源文件存在冲突，请先核对草稿');journal().seal();await recordDraft('work',m.file,String(m.id).startsWith('file:')?undefined:m.id,updateUnit(state.text,m.file,m.id,patch),state.base);journal().seal();await persistHistory();}else{const updated=updateUnit(doc.getText(),m.file,m.id,patch);await applyChanges([{file:m.file,before:doc.getText(),after:updated}],true);}await scan();await web.postMessage({type:'unitPatched'});break;}
        case 'external':{const u=vscode.Uri.parse(m.url);if(['http','https','mailto'].includes(u.scheme))await vscode.env.openExternal(u);break;}
        case 'compile':{if(!bound||!settings().mainFile)throw Error('请先选择主入口');if(compileBusy)throw Error('已有编译任务正在运行');compileBusy=true;const cfg=settings(),recipe=typeof m.recipe==='string'?m.recipe:cfg.latexRecipe!;compileState={running:true,recipe,output:'',error:''};compilePublish();for(const p of panels)void p.webview.postMessage({type:'compiling',value:true});try{const entry=await projectUri(cfg.mainFile),paths=compilationPaths(bound.uri.fsPath,relative(entry),cfg.latexOutDir);await fs.mkdir(paths.output,{recursive:true});await runRecipe(cfg.latexTools!,cfg.latexRecipes!,recipe,paths.variables,async tool=>{compileState.output+=`> ${tool.name}\n`;compilePublish();try{const execution=toolExecution(tool,paths.variables),result=await runTool(tool.command,tool.args,execution.env,execution.cwd);compileState.output+=(result.stdout+'\n'+result.stderr).slice(-200000);compileState.output=compileState.output.slice(-300000);compilePublish();}catch(e:any){compileState.output+=String(e.stdout||'')+'\n'+String(e.stderr||'');throw e;}});for(const p of panels)void p.webview.postMessage({type:'pdfChanged'});}catch(e){compileState.error=e instanceof Error?e.message:String(e);throw e;}finally{compileBusy=false;compileState.running=false;compilePublish();for(const p of panels)void p.webview.postMessage({type:'compiling',value:false});}break;}
        case 'forward':{try{const input=await projectUri(m.file),pdf=await projectUri(settings().pdfFile);const result=await runTool('synctex',['view','-i',`${Math.max(1,Number(m.line)||1)}:0:${input.fsPath}`,'-o',pdf.fsPath]);await web.postMessage({type:'forward',requestId:m.requestId,point:forwardPoint(result.stdout)});}catch{await web.postMessage({type:'syncUnavailable',message:'同步数据尚未就绪，请使用编译按钮生成 SyncTeX'});}break;}
        case 'reverse':{const pdf=await projectUri(settings().pdfFile);if(!Number.isFinite(m.page)||!Number.isFinite(m.x)||!Number.isFinite(m.y))throw Error('PDF 坐标无效');const result=await runTool('synctex',['edit','-o',`${m.page}:${m.x}:${m.y}:${pdf.fsPath}`]);const hit=reversePoint(result.stdout);const absolute=path.isAbsolute(hit.input)?hit.input:path.resolve(bound!.uri.fsPath,hit.input);const rel=path.relative(bound!.uri.fsPath,absolute).split(path.sep).join('/');const uri=await projectUri(rel);const doc=await vscode.workspace.openTextDocument(uri);const offset=doc.offsetAt(new vscode.Position(Math.max(0,hit.line-1),hit.column));const scanned=scanFile(rel,doc.getText());const u=scanned.units.filter(u=>u.start<=offset&&u.end>=offset).sort((a,b)=>(a.end-a.start)-(b.end-b.start))[0]||scanned.units[0];await web.postMessage({type:'reverseResult',unit:u,offset});break;}
        case 'nativeOpen':{const doc=await vscode.workspace.openTextDocument(await projectUri(m.file));const at=Math.max(0,Math.min(doc.getText().length,Number(m.start)||0));await vscode.window.showTextDocument(doc,{selection:new vscode.Range(doc.positionAt(at),doc.positionAt(at))});break;}
        case 'search':{
          if(!bound)throw Error('请先绑定当前项目');
          if(typeof m.query!=='string'||m.query.length>500)throw Error('搜索内容最多 500 个字符');
          const docs:{file:string;text:string}[]=[];
          await Promise.all(files.map(async f=>{const uri=await projectUri(f.path);const text=currentUri?.toString()===uri.toString()&&typeof m.currentText==='string'&&m.currentText.length<=2*1024*1024?m.currentText:await readText(uri);docs.push({file:f.path,text});}));docs.sort((a,b)=>a.file.localeCompare(b.file));
          await web.postMessage({type:'searchResults',requestId:m.requestId,...searchDocuments(docs,m.query,!!m.caseSensitive)});break;
        }
        case 'chooseFile':{const pick=await vscode.window.showQuickPick(files.map(f=>f.path),{placeHolder:'选择 LaTeX 文件'});if(pick){currentUri=await projectUri(pick);await content();}break;}
        case 'save':{
          const uri=currentUri;if(!uri||!bound||vscode.workspace.getWorkspaceFolder(uri)?.uri.toString()!==bound.uri.toString())throw Error('请先绑定文件所属项目');
          if(typeof m.text!=='string'||m.text.length>2*1024*1024)throw Error('内容超过第一版限制');
          const base=lastSent;await projectUri(relative(uri));const doc=await vscode.workspace.openTextDocument(uri);
          if(!base||base.uri!==uri.toString()||m.version!==base.version||doc.getText()!==base.text)throw Error('源文件已改变，已阻止覆盖。请重新载入后编辑。');
          const beforeSave=doc.getText();await recordDraft('work',relative(uri),undefined,m.text,beforeSave,panel);journal().seal();await persistHistory();const edit=new vscode.WorkspaceEdit();edit.replace(uri,new vscode.Range(doc.positionAt(0),doc.positionAt(doc.getText().length)),m.text);
          if(!await vscode.workspace.applyEdit(edit))throw Error('无法写入编辑');if(!await (await vscode.workspace.openTextDocument(uri)).save())throw Error('保存未完成，修改仍保留在文档中');recentWrites.set(relative(uri),{before:beforeSave,after:m.text});journal().markFileSaved(relative(uri));await persistHistory();await writeProjectDraft(relative(uri),m.text,m.text,undefined,panel,'work');const savedDoc=await vscode.workspace.openTextDocument(uri);lastSent={uri:uri.toString(),version:savedDoc.version,text:savedDoc.getText()};await web.postMessage({type:'saved',file:relative(uri),text:savedDoc.getText(),version:savedDoc.version});break;
        }
        case 'reload':await content();break;
        case 'draft':if(bound&&typeof m.file==='string'&&typeof m.text==='string'&&typeof m.base==='string'&&m.text.length<=2*1024*1024){await recordDraft('work',m.file,undefined,m.text,m.base,panel);}else if(currentUri&&bound&&m.uri===currentUri.toString()&&typeof m.text==='string'&&typeof m.base==='string'&&m.text.length<=2*1024*1024){await recordDraft('work',relative(currentUri),undefined,m.text,m.base,panel);}break;
        case 'discardDraft':if(currentUri){const base=await readText(currentUri);await recordDraft('work',relative(currentUri),undefined,base,base);await content();}break;
        case 'projectRead':{const docs=await Promise.all(files.map(async f=>{const s=await projectText(f.path),recovery=context.workspaceState.get<{text:string;base:string}>(`projectConflict:${s.uri.toString()}`);return {file:f.path,text:recovery?.text??s.text,base:recovery?.base??s.base,conflict:!!recovery||s.base!==s.disk};}));await web.postMessage({type:'projectContent',files:docs,mainFile:settings().mainFile,token:randomBytes(8).toString('hex'),requestId:m.requestId});break;}
        case 'projectDraft':{
          if(!Array.isArray(m.changes)||m.changes.length>2000)throw Error('全文草稿无效');const states=[];let conflict=false;
          for(const c of m.changes){if(typeof c.text!=='string'||typeof c.base!=='string'||typeof c.before!=='string'||c.text.length>2*1024*1024)throw Error('全文草稿无效');const s=await projectText(c.file),own=recentWrites.get(c.file),base=own?.before===c.base&&own?.after===s.disk?s.disk:c.base;if(base!==s.disk||(s.text!==c.before&&s.text!==c.text))conflict=true;states.push({c,s,base});}
          if(conflict){for(const {c,s,base}of states)await context.workspaceState.update(`projectConflict:${s.uri.toString()}`,{text:c.text,base});throw Error('文件已变化，全文草稿已保留，请核对冲突');}
          journal().record('work',states.map(({c,s})=>({file:c.file,before:s.text,after:c.text})));for(const {c,base}of states)await writeProjectDraft(c.file,c.text,base,undefined,panel,'work');await persistHistory();break;
        }
        case 'projectSave':{
          if(!Array.isArray(m.changes)||m.changes.length>2000)throw Error('全文保存请求无效');const changes:Change[]=[];
          for(const c of m.changes){if(typeof c.text!=='string'||typeof c.base!=='string'||c.text.length>2*1024*1024)throw Error('全文内容无效');const s=await projectText(c.file),doc=await vscode.workspace.openTextDocument(s.uri);if(doc.isDirty||s.disk!==c.base||s.base!==s.disk||s.text!==c.text)throw Error('源文件已变化，请核对全文草稿后保存');changes.push({file:c.file,before:s.disk,after:c.text});}
          await applyChanges(changes);for(const c of changes){journal().markFileSaved(c.file);await writeProjectDraft(c.file,c.after,c.after,undefined,panel,'work');await context.workspaceState.update(`projectConflict:${(await projectUri(c.file)).toString()}`,undefined);}await persistHistory();await web.postMessage({type:'projectSaved',files:changes.map(c=>({file:c.file,text:c.after}))});await scan();break;
        }
        case 'projectDiscard':{if(!Array.isArray(m.files)||m.files.length>2000)throw Error('全文目标无效');const states=await Promise.all(m.files.map((file:string)=>projectText(file)));journal().record('work',states.map((s,i)=>({file:m.files[i],before:s.text,after:s.disk})));for(let i=0;i<states.length;i++){await writeProjectDraft(m.files[i],states[i].disk,states[i].disk);await context.workspaceState.update(`projectConflict:${states[i].uri.toString()}`,undefined);}await persistHistory();break;}
        case 'fullText':await web.postMessage({type:'fullText',text:await fullText()});break;
        case 'settings':{
          const s=m.settings as Settings;if(s?.latexTools&&s?.latexRecipes)validateCompilation(s.latexTools,s.latexRecipes);if(s?.latexOutDir&&bound)compilationPaths(bound.uri.fsPath,s.mainFile||'main.tex',s.latexOutDir);if(s?.agent&&(![...agentPriority,''].includes(s.agent.name)||typeof s.agent.path!=='string'||s.agent.path.length>4096))throw Error('Agent 设置无效');const oldAgent=JSON.stringify(settings().agent);const oldAgentPath=settings().aiCodexPath,oldPrompt=settings().aiPrompt;
          if(!s||typeof s.mainFile!=='string'||typeof s.projectName!=='string'||s.projectName.length>100||typeof s.autoScan!=='boolean'||typeof s.wordWrap!=='boolean'||!['source','split','pdf'].includes(s.defaultLayout)||!Number.isFinite(s.fontSize)||s.fontSize<10||s.fontSize>28||!Number.isFinite(s.previewWidth)||s.previewWidth<400||s.previewWidth>1400)throw Error('设置值无效');if(s.previewFontSize!==undefined&&(!Number.isFinite(s.previewFontSize)||s.previewFontSize<12||s.previewFontSize>24))throw Error('预览字号应为 12–24');
          if(s.defaultView&&!['structure','work','references','ai','compile'].includes(s.defaultView))throw Error('默认视图无效');if(s.compiler&&!['pdflatex','xelatex','lualatex','custom'].includes(s.compiler))throw Error('编译器无效');
          if(s.mainFile){if(!s.mainFile.endsWith('.tex'))throw Error('主入口必须是 .tex 文件');if(bound)await projectUri(s.mainFile);}
          if(s.aiAgent&&!agentPriority.includes(s.aiAgent))throw Error('暂不支持该 Agent');if(s.aiPrompt!==undefined&&(typeof s.aiPrompt!=='string'||s.aiPrompt.length>2000))throw Error('公共提示最多 2000 字');if(s.historyLimit!==undefined&&(!Number.isInteger(s.historyLimit)||s.historyLimit<10||s.historyLimit>10000))throw Error('操作记录上限应为 10–10000 的整数');if(s.debug!==undefined&&typeof s.debug!=='boolean')throw Error('Debug 设置无效');if(s.theme&&!['system','light','dark'].includes(s.theme))throw Error('主题无效');if(s.compilerArgs&&(!Array.isArray(s.compilerArgs)||s.compilerArgs.some(a=>typeof a!=='string'||a.length>1000)))throw Error('编译参数无效');
          for(const [key,value]of Object.entries(s))if(['projectName','mainFile','autoScan','fontSize','wordWrap','defaultLayout','previewWidth','previewFontSize','defaultView','compiler','compilerCommand','compilerArgs','theme','aiCodexPath','debug','historyLimit','latexTools','latexRecipes','latexRecipe','latexOutDir','agent','aiAgent','aiPrompt'].includes(key))if(JSON.stringify(config().get(settingName(key)))!==JSON.stringify(value))await saveSetting(key,value);
          await persistHistory();broadcast();await web.postMessage({type:'settingsSaved'});if(oldAgent!==JSON.stringify(settings().agent)||oldAgentPath!==settings().aiCodexPath||oldPrompt!==settings().aiPrompt){ai?.dispose();ai=undefined;void detectAgent(undefined,true,oldAgent!==JSON.stringify(settings().agent)).catch(report);}break;
        }
        case 'showDebug':output.show(true);break;
        case 'stopDebugProfile':await debug.stop();output.show(true);break;
        case 'notify':{if(typeof m.message==='string')void vscode.window.showInformationMessage(m.message.slice(0,500));break;}
        case 'fullscreen':await vscode.commands.executeCommand('workbench.action.toggleFullScreen');break;
        case 'history':{
          const forward=m.action==='redo',j=journal(),entry=j.peek(forward);if(!entry)break;
          const targets:{file:string;id?:string;start:number}[]=[],changes:Change[]=[],draftUpdates:{file:string;text:string;base:string;id?:string}[]=[];
          for(const c of entry.changes){const file=!forward&&c.renameTo?c.renameTo:c.file,state=await projectText(file);if(state.base!==state.disk)throw Error('源文件已变化，请先核对恢复的草稿');let next:string,offset=0;
            if(entry.kind==='map'){const u=findUnit(file,state.text,c.id!);if(!u)throw Error('目标片段已改变，草稿仍保留');offset=u.start;const patched=patchText(state.text.slice(u.start,u.end),c.patch,forward);next=state.text.slice(0,u.start)+patched+state.text.slice(u.end);
            }else{if(entry.kind==='disk'&&state.text!==state.disk)throw Error('目标文件有未保存草稿，请先保存再撤销文件操作');next=patchText(state.text,c.patch,forward);}
            if(entry.kind!=='disk'&&(state.text!==state.disk||!entry.committed))draftUpdates.push({file,text:next,base:state.disk,id:c.id});else changes.push({file,before:state.disk,after:next,...(c.renameTo?{renameTo:forward?c.renameTo:c.file}:{})});
            targets.push({file:forward?(c.renameTo||file):c.file,id:c.id,start:offset+c.patch.start});
          }
          if(changes.length)await applyChanges(changes);
          for(const u of draftUpdates)await writeProjectDraft(u.file,u.text,u.base,u.id);
          j.complete(forward);await persistHistory();if(changes.length||draftUpdates.length)await scan();
          for(const target of targets){const state=await projectText(target.file);for(const p of panels)void p.webview.postMessage({type:'draftSync',file:target.file,text:state.text,base:state.disk});}
          if(targets[0]){currentUri=await projectUri(targets[0].file);await web.postMessage({type:'historyNavigate',targets,ai:entry.ai});await content(true);}break;
        }
        case 'agentDetect':{await detectAgent(typeof m.path==='string'&&m.path?m.path:undefined,m.connect!==false,true,m.agent);break;}
        case 'agentChoose':{const selected=await vscode.window.showOpenDialog({canSelectFiles:true,canSelectFolders:false,canSelectMany:false,openLabel:'选择 Agent',title:'选择 AI 命令行工具'});if(selected?.[0])await detectAgent(selected[0].fsPath,true,true,'');break;}
        case 'aiConnect':await getAI().connect();break;
        case 'aiNew':{const session=getAI().newSession();await web.postMessage({type:'aiSelected',id:session.id});break;}
        case 'aiRequirement':await getAI().updateRequirement(m.requirement);break;
        case 'aiRemoveRequirement':getAI().removeRequirement(m.id);break;
        case 'aiSubmit':{const id=await getAI().submit(m);await web.postMessage({type:'aiSelected',id});break;}
        case 'aiStop':await getAI().stop(m.sessionId);break;
        case 'aiApplyBatch':{const manager=getAI(),session=manager.state.sessions.find(s=>s.id===m.sessionId);if(!session)throw Error('会话不存在');const candidates=session.candidates.filter(c=>c.status==='pending'&&c.messageIndex===m.messageIndex);if(!candidates.length)break;const changes=candidates.map(c=>({file:c.file,before:c.before,after:c.after}));if(new Set(changes.map(c=>c.file)).size!==changes.length)throw Error('同一文件存在多个候选，请分别核对后应用');await applyChanges(changes,true,true);for(const c of candidates)manager.mark(m.sessionId,c.id,'applied');await scan();await web.postMessage({type:'historyNavigate',ai:true,targets:changes.map(c=>({file:c.file,start:0}))});await content(true);break;}
        case 'aiCandidate':{const manager=getAI(),c=manager.candidate(m.sessionId,m.id);if(m.action==='diff')await web.postMessage({type:'diff',diff:{kind:'ai',title:'AI 修改 · '+c.file,file:c.file,before:c.before,after:c.after,sessionId:m.sessionId,candidateId:c.id,candidateStatus:c.status}});else if(c.status!=='pending')throw Error('此修改已经处理');else if(m.action==='apply'){await applyChanges([{file:c.file,before:c.before,after:c.after}],true,true);await web.postMessage({type:'historyNavigate',ai:true,targets:[{file:c.file,start:0}]});manager.mark(m.sessionId,m.id,'applied');await scan();await content();}else if(m.action==='reject')manager.mark(m.sessionId,m.id,'rejected');break;}
        case 'editing':panelDrafts.set(panel,m.dirty===true);break;
        case 'clipboardRead':await web.postMessage({type:'clipboardResult',id:m.id,text:await vscode.env.clipboard.readText()});break;
        case 'clipboardWrite':if(typeof m.text==='string'&&m.text.length<=2*1024*1024)await vscode.env.clipboard.writeText(m.text);break;
        case 'gitRefresh':await refreshGit();break;
        case 'gitCommit':{if([...panelDrafts.values()].some(Boolean))throw Error('请先保存所有工作台中的编辑内容，再提交版本');if(vscode.workspace.textDocuments.some(d=>d.isDirty&&bound&&path.relative(bound.uri.fsPath,d.uri.fsPath).split(path.sep)[0]!=='..'))throw Error('请先保存项目中的编辑内容，再提交版本');await getGit().commit(m.message);await refreshGit();break;}
        case 'gitIgnore':await getGit().saveIgnore(m.text,m.before);await refreshGit();break;
        case 'gitFileHistory':await web.postMessage({type:'gitFileHistory',file:m.file,history:await getGit().fileHistory(m.file)});break;
        case 'gitDiff':{const diff=await getGit().diff(m.file||relative(currentUri!),m.revision);if(m.unitId&&!String(m.unitId).startsWith('file:')&&!diff.binary){const slice=(text:string)=>{const p=scanFile(diff.file,text),u=[...p.units,...(p.structuralHeadings||[])].find(u=>u.id===m.unitId);return u?text.slice(u.start,u.end):'';};diff.before=slice(diff.before);diff.after=slice(diff.after);diff.title+=' · '+String(m.unitTitle||m.unitId);}await web.postMessage({type:'diff',diff});break;}
        case 'pdf':{const file=settings().pdfFile;if(!file){await web.postMessage({type:'pdf',url:'',message:'请先选择主入口文件'});break;}try{const started=Date.now(),uri=await projectUri(file),bytes=await vscode.workspace.fs.readFile(uri),key=pdfArtifacts?.key(bytes)||String((await vscode.workspace.fs.stat(uri)).mtime),manifest=pdfArtifacts?await pdfArtifacts.read(key):undefined;const cached=manifest?await pdfArtifacts!.page(key,manifest.view?.page||1):undefined;const image=cached?.image&&pdfStorage?web.asWebviewUri(vscode.Uri.joinPath(pdfStorage,key,cached.image)).toString():undefined;await web.postMessage({type:'pdf',url:web.asWebviewUri(uri).toString(),revision:key,cacheKey:manifest?key:undefined,textPages:manifest?.pages.filter(p=>p.hasText).map(p=>p.page),cached:cached?{...cached,image}:undefined,view:manifest?.view});debug.event('pdf.identify',{durationMs:Date.now()-started,bytes:bytes.length,cached:!!image});}catch{await web.postMessage({type:'pdf',url:'',message:`等待项目根目录下的 ${file}`});}break;}
        case 'pdfCachePage':{if(pdfArtifacts&&typeof m.key==='string')try{await pdfArtifacts.save(m.key,m.page,m.png);}catch(e){output.appendLine('PDF 页面缓存：'+String(e));}break;}
        case 'pdfCacheView':{if(pdfArtifacts&&typeof m.key==='string')await pdfArtifacts.saveView(m.key,m.view);break;}
        case 'previewContext':{if(!bound)break;const docs=await Promise.all(files.map(async f=>({file:f.path,text:(await projectText(f.path)).text})));const uris=await vscode.workspace.findFiles(new vscode.RelativePattern(bound,'**/*.bib'),'**/{node_modules,.git,dist,build,out}/**',100);const entries:BibEntry[]=[];let bytes=0;for(const uri of uris){const rel=relative(uri);if(!rel.endsWith('.bib'))continue;await projectUri(rel);const info=await vscode.workspace.fs.stat(uri);bytes+=info.size;if(info.size>2*1024*1024||bytes>20*1024*1024)continue;entries.push(...parseBibliography(rel,await readText(uri)).entries);}await web.postMessage({type:'previewContext',requestId:m.requestId,context:buildPreviewContext(docs,settings().mainFile,entries)});break;}
        case 'assets':{
          if(!bound)break;const list:Array<{name:string;url:string}>=[],roots=[''];if(settings().mainFile){try{const main=(await projectText(settings().mainFile)).text;for(const m of main.matchAll(/\\graphicspath\s*\{/g)){const g=groupAt(main,m.index!+m[0].length-1);if(g)for(const part of g.value.matchAll(/\{([^}]+)\}/g))roots.push(part[1].trim(),path.posix.join(path.posix.dirname(settings().mainFile),part[1].trim()));}}catch{}}
          for(const name of (Array.isArray(m.names)?m.names:[]).slice(0,100)){
            if(typeof name!=='string')continue;
            let found=false;for(const base of [...new Set([...roots,...(m.rooted?[]:[path.posix.dirname(m.file||settings().mainFile)])])]){for(const suffix of (path.posix.extname(name)?['']:['.png','.jpg','.jpeg','.svg','.pdf'])){
              try{const rel=normalizeRelative(path.posix.join(base,name+suffix));const uri=await projectUri(rel);list.push({name,url:web.asWebviewUri(uri).toString()});found=true;break;}catch{}
            }if(found)break;}
          }await web.postMessage({type:'assets',assets:list,requestId:m.requestId,file:m.file});break;
        }
      }
    }catch(e){debug.event('message.failed',{type:m.type,error:String(e)});report(e);await web.postMessage({type:'operationFailed',operation:m.type,message:e instanceof Error?e.message:String(e),requestId:m.requestId,file:m.file,id:m.id});}finally{release?.();if(!['draft','performance','debug'].includes(m.type))debug.event('message.completed',{type:m.type,durationMs:Date.now()-messageStarted});}},undefined,context.subscriptions);
    return panel;
  }
  async function openWorkbench(doc?:vscode.TextDocument,structure=false){
    const boot=startupPanel;if(boot){await panelTargets.get(boot)?.(doc,structure);boot.reveal(vscode.ViewColumn.Active);return boot;}
    return openPanel(doc,structure);
  }
  async function ensureAutomaticHostIsolation(){
    if(!vscode.workspace.workspaceFolders?.length||!config().get('autoHostIsolation',true))return;
    if(!automaticHostTask)automaticHostTask=configureHostIsolation(true,true).finally(()=>{automaticHostTask=undefined;});
    await automaticHostTask;
  }
  async function configureHostIsolation(enabled:boolean,automatic=false){
    if(!vscode.workspace.workspaceFolders?.length)throw Error('请先打开项目文件夹，再配置工作区独立宿主');
    if(!automatic&&config().get('autoHostIsolation',true)!==enabled)await saveSetting('autoHostIsolation',enabled);
    const target=await settingTarget(),c=vscode.workspace.getConfiguration('extensions'),name='experimental.affinity',current=c.inspect<Record<string,unknown>>(name),effective=c.get(name,{}),local=target===vscode.ConfigurationTarget.Global?current?.globalValue:current?.workspaceFolderValue??current?.workspaceValue,plan=enabled?planHostIsolation(effective,local):undefined;
    if(automatic&&(!plan?.changed||(configuredHostAffinity(effective)>0&&plan.affinity===configuredHostAffinity(effective))))return;
    const value=plan?plan.value:removeHostIsolation(local);
    if(!plan||plan.changed)await c.update(name,value,target);
    output.appendLine(`[host isolation] configured=${enabled} group=${plan?.affinity||0} scope=workspace currentPid=${process.pid}; complete window reload required`);
    const inherited=!enabled?configuredHostAffinity(c.get(name,{})):0;
    const text=enabled?`已为 LaTeX Pro 配置独立宿主（分组 ${plan!.affinity}）。保存编辑内容后重载窗口生效。`:inherited?'已移除工作区配置；用户设置仍有宿主分组。保存编辑内容后重载窗口生效。':'已移除工作区独立宿主配置。保存编辑内容后重载窗口生效。';
    void vscode.window.showInformationMessage(text,'重载窗口').then(action=>{if(action==='重载窗口')return vscode.commands.executeCommand('workbench.action.reloadWindow');}).then(undefined,report);
  }
  context.subscriptions.push(vscode.commands.registerCommand('latexPro.isolateHost',()=>configureHostIsolation(true).catch(report)),vscode.commands.registerCommand('latexPro.clearHostIsolation',()=>configureHostIsolation(false).catch(report)));
  context.subscriptions.push(vscode.commands.registerCommand('latexPro.startupDiagnostics',()=>output.show(true)),vscode.commands.registerCommand('latexPro.enableDebug',async()=>{await saveSetting('debug',true);debug.refresh();output.show(true);}),vscode.commands.registerCommand('latexPro.finishDebugProfile',async()=>{await debug.stop();output.show(true);}),vscode.commands.registerCommand('latexPro.search',()=>{const active=[...panels].find(p=>p.active);if(active)void active.webview.postMessage({type:'searchFocus'});}),vscode.commands.registerCommand('latexPro.open',()=>openWorkbench(vscode.window.activeTextEditor?.document)),vscode.commands.registerCommand('latexPro.structure',()=>openWorkbench(undefined,true)),vscode.commands.registerCommand('latexPro.bind',()=>bind().catch(report)),vscode.window.registerCustomEditorProvider('latexPro.editor',{resolveCustomTextEditor:async(doc,panel)=>{const boot=startupPanel;if(boot&&boot!==panel){startupPanel=undefined;boot.dispose();}openPanel(doc,false,panel);}},{webviewOptions:{retainContextWhenHidden:true},supportsMultipleEditorsPerDocument:true}));
  let timer:ReturnType<typeof setTimeout>|undefined;
  const schedule=()=>{if(!bound||!settings().autoScan)return;clearTimeout(timer);timer=setTimeout(()=>void scan().catch(report),250);};
  const watcher=vscode.workspace.createFileSystemWatcher('**/*.tex');
  context.subscriptions.push(watcher,watcher.onDidCreate(schedule),watcher.onDidDelete(schedule),watcher.onDidChange(schedule),vscode.workspace.onDidSaveTextDocument(d=>{if(d.languageId==='latex'||d.uri.path.endsWith('.tex'))schedule();}),vscode.workspace.onDidChangeConfiguration(e=>{if(e.affectsConfiguration('latexPro.debug')){debug.refresh();for(const p of panels)void p.webview.postMessage({type:'debugConfig',enabled:config().get('debug',false)});}if(e.affectsConfiguration('latexPro')||e.affectsConfiguration('editor')){broadcast();void checkProjectConfiguration();}if(e.affectsConfiguration('workbench.colorTheme')||e.affectsConfiguration('editor.tokenColorCustomizations'))void editorColors().then(colors=>{nativeColors=colors;broadcast();});}),vscode.workspace.onDidChangeWorkspaceFolders(()=>{ai?.dispose();ai=undefined;bound=undefined;files=[];broadcast();}),{dispose:()=>clearTimeout(timer)});
  const configWatcher=vscode.workspace.createFileSystemWatcher('**/.vscode/settings.json');const checkConfig=()=>void checkProjectConfiguration();context.subscriptions.push(configWatcher,configWatcher.onDidCreate(checkConfig),configWatcher.onDidChange(checkConfig),configWatcher.onDidDelete(checkConfig));
  const pdfWatcher=vscode.workspace.createFileSystemWatcher('**/*.pdf');
  const refreshPdf=()=>{for(const p of panels)void p.webview.postMessage({type:'pdfChanged'});};
  context.subscriptions.push(pdfWatcher,pdfWatcher.onDidCreate(refreshPdf),pdfWatcher.onDidChange(refreshPdf),pdfWatcher.onDidDelete(refreshPdf));
  // Restore metadata immediately; refresh file contents after the first UI paint.
  if(bound){const cached=context.workspaceState.get<ScanFile[]>('scanCache.v3');if(cached)files=cached;}
  function startBackground(){if(backgroundStarted)return;backgroundStarted=true;debug.event('background.begin');if(bound)void (async()=>{await checkProjectConfiguration();await ensureCompilationConfig();await detectAgent();})().catch(e=>output.appendLine(String(e)));if(bound)void refreshGit().catch(report);void ensureAutomaticHostIsolation().catch(report);void debug.measure('editor.theme',{},()=>editorColors()).then(colors=>{nativeColors=colors;broadcast();}).catch(e=>output.appendLine(String(e)));}
  context.subscriptions.push({dispose:()=>{extensionDisposed=true;ai?.dispose();}});
  // A first-run panel is created during activation, before VS Code dispatches the waiting open command.
  if(vscode.workspace.workspaceFolders?.length&&context.globalState?.get<string>('startup.initializedBuild')!==startupBuild)startupPanel=openPanel(vscode.window.activeTextEditor?.document);
  timing('extension activated',Date.now()-activated);
  return {getStartupTimings:()=>timings.map(t=>({...t}))};
}
