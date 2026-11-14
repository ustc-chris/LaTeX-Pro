import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {mkdtemp,writeFile,readFile,rm,stat,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

test('workbench reopens closed documents for reload/save and keeps conflict protection',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'lp-lifecycle-'));
 try{
  const file=path.join(root,'main.tex');await writeFile(file,'Original body\n');
  const uri=(p:string):any=>({fsPath:p,path:p,scheme:'file',toString:()=>`file://${p}`});
  const rootUri=uri(root),fileUri=uri(file),folder={uri:rootUri,name:'test'};
  const store=new Map<string,unknown>([['boundRoot',rootUri.toString()]]),commands=new Map();
  const sent:any[]=[],errors:string[]=[],documents:any[]=[];let receive:(m:any)=>Promise<void>,changed:(e:any)=>void=()=>{};
  const disposable={dispose(){}};let opened=0,scans=0;
  async function openTextDocument(u:any){let d=documents.find(d=>!d.isClosed&&d.uri.toString()===u.toString());if(d)return d;opened++;let text=await readFile(u.fsPath,'utf8');d={uri:u,version:1,isClosed:false,languageId:'latex',getText:()=>text,positionAt:(n:number)=>n,save:async()=>{if(d.isClosed)throw Error('Document has been closed');await writeFile(u.fsPath,text);return true;},replace:(value:string)=>{text=value;d.version++;}};documents.push(d);return d;}
  class WorkspaceEdit{edits:any[]=[];replace(u:any,_range:any,text:string){this.edits.push({uri:u,text});}}
  const web:any={cspSource:'test',asWebviewUri:(u:any)=>u,postMessage:async(m:any)=>{sent.push(m);return true;},onDidReceiveMessage:(cb:any)=>{receive=cb;return disposable;}};
  let createdPanels=0;const panel:any={webview:web,active:true,reveal(){},dispose(){},onDidChangeViewState:()=>disposable,onDidDispose:()=>disposable};
  const vscode:any={extensions:{all:[]},Uri:{joinPath:(u:any,...rest:string[])=>uri(path.join(u.fsPath,...rest))},ViewColumn:{Active:1},ConfigurationTarget:{Workspace:1,Global:2},RelativePattern:class{},WorkspaceEdit,Range:class{constructor(..._args:any[]){}},
   commands:{registerCommand:(name:string,fn:any)=>{commands.set(name,fn);return disposable;},executeCommand:async()=>{}},
   window:{activeTextEditor:undefined,createOutputChannel:()=>({...disposable,appendLine(){}}),createWebviewPanel:()=>{createdPanels++;return panel;},registerCustomEditorProvider:()=>disposable,showErrorMessage:(s:string)=>errors.push(s)},
   workspace:{onDidRenameFiles:()=>disposable,registerTextDocumentContentProvider:()=>disposable,workspaceFolders:[folder],getConfiguration:(section:string)=>({get:(key:string,fallback:any)=>section==='extensions'&&key==='experimental.affinity'?{'latex-pro-local.latex-pro':1}:fallback,inspect:()=>({workspaceValue:{'latex-pro-local.latex-pro':1}})}),getWorkspaceFolder:()=>folder,openTextDocument,get textDocuments(){return documents.filter(d=>!d.isClosed);},findFiles:async()=>{scans++;return [fileUri];},fs:{readFile:async(u:any)=>readFile(u.fsPath),writeFile:async(u:any,data:any)=>writeFile(u.fsPath,data),stat:async(u:any)=>stat(u.fsPath)},onDidChangeTextDocument:(cb:any)=>{changed=cb;return disposable;},onDidSaveTextDocument:()=>disposable,onDidChangeConfiguration:()=>disposable,onDidChangeWorkspaceFolders:()=>disposable,createFileSystemWatcher:()=>({...disposable,onDidCreate:()=>disposable,onDidDelete:()=>disposable,onDidChange:()=>disposable}),applyEdit:async(edit:any)=>{for(const e of edit.edits){const d=await openTextDocument(e.uri);d.replace(e.text);changed({document:d});}return true;}}};
  const bundle=await build({entryPoints:['src/extension.ts'],bundle:true,platform:'node',format:'cjs',external:['vscode'],write:false});
  const module={exports:{} as any},require=createRequire(import.meta.url);
  runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,require:(id:string)=>id==='vscode'?vscode:require(id),process,Buffer,TextDecoder,TextEncoder,setTimeout,clearTimeout,console});
  const context:any={subscriptions:[],workspaceState:{get:(key:string)=>store.get(key),update:async(key:string,value:any)=>{store.set(key,value);}},extensionUri:uri(root),extension:{packageJSON:{version:'test'}}};
  const extensionAPI=module.exports.activate(context);
  assert.equal(createdPanels,1,'first-run shell is created during activation, before the open command');assert.ok(web.html.includes('lp-startup'));assert.equal(documents.length,0,'initial shell does not wait for opening source documents');assert.equal(scans,0,'project scan is deferred until the UI is displayed');
  const first=await openTextDocument(fileUri);first.version=7;vscode.window.activeTextEditor={document:first};
  await commands.get('latexPro.open')();assert.equal(createdPanels,1,'first open reuses the early shell');await receive!({type:'ready'});assert.ok(sent.some(m=>m.type==='startupComplete'));await receive!({type:'appDisplayed',clientMs:30});
  assert.equal(sent.filter(m=>m.type==='content').at(-1).version,7);
  await receive!({type:'performance',name:'editor module loaded',clientMs:250,durationMs:35});const measured=extensionAPI.getStartupTimings().find((t:any)=>t.name==='editor module loaded');assert.equal(measured.clientMs,250);assert.equal(measured.durationMs,35);assert.ok(measured.at);

  first.isClosed=true;
  await receive!({type:'save',version:7,text:'Saved after native tab closed\n'});
  assert.ok(sent.some(m=>m.type==='saved'),errors.join('\n'));assert.equal(await readFile(file,'utf8'),'Saved after native tab closed\n');assert.equal(errors.length,0,errors.join('\n'));
  await receive!({type:'draft',file:'main.tex',base:'Original body\n',text:'Saved after native tab closed\nTyped while saving.\n'});const lateDraft=store.get('draft:'+fileUri.toString()) as any;assert.equal(lateDraft.base,'Saved after native tab closed\n','late input rebases only across our own save');assert.ok(lateDraft.text.includes('Typed while saving.'));await receive!({type:'discardDraft'});
  for(const d of documents)d.isClosed=true;
  await receive!({type:'reload'});assert.equal(sent.filter(m=>m.type==='content').at(-1).text,'Saved after native tab closed\n');
  const last=sent.filter(m=>m.type==='content').at(-1);for(const d of documents)d.isClosed=true;
  await writeFile(file,'External change\n');await receive!({type:'save',version:last.version,text:'Overwrite attempt'});
  assert.equal(await readFile(file,'utf8'),'External change\n');assert.ok(errors.some(s=>s.includes('源文件已改变')));
  const before=opened;await receive!({type:'fullText'});await receive!({type:'search',query:'External',requestId:1});assert.equal(opened,before,'read-only operations must not create native documents');
  await receive!({type:'unitPatch',file:'main.tex',id:'file:main.tex',patch:{status:'final',tag:'终稿',time:'2026-11-14T00:00:00+08:00'}});assert.match(await readFile(file,'utf8'),/终稿/);
  await receive!({type:'history',action:'undo'});assert.equal(await readFile(file,'utf8'),'External change\n');
  await receive!({type:'history',action:'redo'});assert.match(await readFile(file,'utf8'),/终稿/);
  await mkdir(path.join(root,'.vscode'),{recursive:true});await writeFile(path.join(root,'.vscode/settings.json'),'{// project overrides\n}');
  const userAffinity={'other.extension':1},writes:any[]=[],executed:string[]=[];let autoHostIsolation=true,notifications=0;let workspaceAffinity:any={'latex-pro-local.latex-pro':1,'work.extension':3};
  vscode.workspace.getConfiguration=(section:string)=>({get:(key:string,fallback:any)=>section==='extensions'&&key==='experimental.affinity'?{...userAffinity,...workspaceAffinity}:key==='autoHostIsolation'?autoHostIsolation:key==='mainFile'?'main.tex':fallback,inspect:()=>({workspaceValue:workspaceAffinity,globalValue:userAffinity}),update:async(key:string,value:any,target:any)=>{writes.push({section,key,value,target});if(section==='extensions')workspaceAffinity=value;if(key==='autoHostIsolation')autoHostIsolation=value;}});
  vscode.window.showInformationMessage=async()=>{notifications++;return '重载窗口';};vscode.commands.executeCommand=async(name:string)=>{executed.push(name);};
  await commands.get('latexPro.isolateHost')();assert.equal(workspaceAffinity['latex-pro-local.latex-pro'],2);assert.equal(workspaceAffinity['work.extension'],3);assert.equal(workspaceAffinity['other.extension'],undefined);assert.equal(writes[0].section,'extensions');assert.equal(writes[0].target,vscode.ConfigurationTarget.Workspace);assert.ok(executed.includes('workbench.action.reloadWindow'));assert.deepEqual(userAffinity,{'other.extension':1});
  await commands.get('latexPro.clearHostIsolation')();assert.deepEqual({...workspaceAffinity},{'work.extension':3});assert.equal(writes.filter(w=>w.section==='extensions').length,2);assert.equal(autoHostIsolation,false);
  vscode.window.showInformationMessage=async()=>{notifications++;return undefined;};const reloads=executed.length;await commands.get('latexPro.bind')();assert.equal(writes.filter(w=>w.section==='extensions').length,2,'explicit opt-out must survive binding');
  autoHostIsolation=true;await commands.get('latexPro.bind')();assert.equal(workspaceAffinity['latex-pro-local.latex-pro'],2);assert.equal(writes.filter(w=>w.section==='extensions').length,3);const shown=notifications;await commands.get('latexPro.bind')();assert.equal(writes.filter(w=>w.section==='extensions').length,3,'existing isolation is not rewritten');assert.equal(notifications,shown,'existing isolation does not prompt repeatedly');assert.equal(executed.length,reloads,'automatic setup never reloads without the user choosing it');
  await receive!({type:'reload'});const current=sent.filter(m=>m.type==='content').at(-1);const mapText='% !lp begin {"id":"a","title":"A"}\nA original.\n% !lp end\n% !lp begin {"id":"b","title":"B"}\nB original.\n% !lp end\n';await receive!({type:'save',version:current.version,text:mapText});await receive!({type:'unitRead',file:'main.tex',id:'fragment:a',requestId:1});const a=sent.filter(m=>m.type==='unitContent').at(-1).text;await receive!({type:'unitRead',file:'main.tex',id:'fragment:b',requestId:2});const b=sent.filter(m=>m.type==='unitContent').at(-1).text;await receive!({type:'unitDraft',file:'main.tex',id:'fragment:a',base:a,text:'A draft.'});assert.ok(store.get('mapDraft:main.tex:fragment:a'));await receive!({type:'unitSave',file:'main.tex',id:'fragment:b',before:b,text:'B changed.\n',requestId:3});await receive!({type:'unitSave',file:'main.tex',id:'fragment:a',before:a,text:'A changed.\n',requestId:4});const mapSaved=await readFile(file,'utf8');assert.ok(mapSaved.includes('A changed.')&&mapSaved.includes('B changed.'));assert.equal(store.get('mapDraft:main.tex:fragment:a'),undefined);await receive!({type:'unitSave',file:'main.tex',id:'fragment:a',before:a,text:'stale overwrite',requestId:5});assert.equal(await readFile(file,'utf8'),mapSaved);assert.ok(sent.some(m=>m.type==='operationFailed'&&m.operation==='unitSave'&&m.requestId===5),'map conflict replies keep request identity');
  // A map draft is undoable without writing the source; redo survives serialization.
  await receive!({type:'unitRead',file:'main.tex',id:'fragment:a',requestId:91});const currentA=sent.filter(m=>m.type==='unitContent').at(-1).text;
  await receive!({type:'unitDraft',file:'main.tex',id:'fragment:a',base:currentA,text:'Resume me after restart.'});
  await receive!({type:'history',action:'undo'});assert.equal(await readFile(file,'utf8'),mapSaved,'undo of an unsaved draft must not save the file');assert.equal(store.get('mapDraft:main.tex:fragment:a'),undefined);
  await receive!({type:'history',action:'redo'});assert.equal(await readFile(file,'utf8'),mapSaved);assert.equal((store.get('mapDraft:main.tex:fragment:a') as any).text,'Resume me after restart.\n');
  const persisted=store.get('history.v1:'+rootUri.toString()) as any;assert.ok(persisted.undo.length>0);assert.equal(persisted.undo.at(-1).kind,'map');assert.equal(persisted.undo.at(-1).committed,undefined);
  assert.ok(sent.some(m=>m.type==='historyNavigate'&&m.targets[0]?.id==='fragment:a'),'history carries the target for map/work reveal');
  await receive!({type:'unitRead',file:'main.tex',id:'fragment:a',requestId:92});assert.equal(sent.filter(m=>m.type==='unitContent').at(-1).recovery.text,'Resume me after restart.\n');
  await receive!({type:'reload'});await receive!({type:'open',file:'main.tex'});const recoveredWork=sent.filter(m=>m.type==='content').at(-1);assert.ok(recoveredWork.recoveredText.includes('Resume me after restart.'),'writing reuses the map draft');
  const working=recoveredWork.recoveredText.replace('B changed.','B changed from writing.');await receive!({type:'draft',file:'main.tex',base:recoveredWork.text,text:working});await receive!({type:'unitRead',file:'main.tex',id:'fragment:b',requestId:93});assert.ok(sent.filter(m=>m.type==='unitContent').at(-1).recovery.text.includes('B changed from writing.'),'map reuses the writing draft');
  await receive!({type:'history',action:'undo'});assert.ok((store.get('draft:'+fileUri.toString()) as any).text.includes('Resume me after restart.'),'undo writing preserves the earlier map draft');assert.ok(!(store.get('draft:'+fileUri.toString()) as any).text.includes('B changed from writing.'));assert.equal(await readFile(file,'utf8'),mapSaved);
  const fullscreenStart=executed.length,settingsWrites=writes.length;await receive!({type:'fullscreen'});assert.deepEqual(executed.slice(fullscreenStart),['workbench.action.toggleFullScreen'],'fullscreen must use the native window action, not centered Zen mode');assert.equal(writes.length,settingsWrites,'fullscreen must not modify user/workspace settings');
  await receive!({type:'gitRefresh'});
  assert.ok(sent.some(m=>m.type==='gitState'));
  // Existing project JSON receives missing keys, preserving comments and explicit values.
  await writeFile(path.join(root,'.vscode/settings.json'),'{// keep me\n"latexPro.wordWrap":false,\n"editor.fontSize":19\n}');await commands.get('latexPro.bind')();const completedConfig=await readFile(path.join(root,'.vscode/settings.json'),'utf8');assert.ok(completedConfig.includes('// keep me'));assert.match(completedConfig,/"latexPro.wordWrap":false/);assert.ok(completedConfig.includes('latexPro.historyLimit'));
  await rm(path.join(root,'.vscode/settings.json'));const configValues=sent.filter(m=>m.type==='snapshot').at(-1).snapshot.settings;await receive!({type:'settings',settings:{...configValues,projectName:'Global preference'}});assert.equal(writes.filter(w=>w.section==='latexPro'&&w.key==='projectName').at(-1).target,vscode.ConfigurationTarget.Global);assert.equal(await stat(path.join(root,'.vscode/settings.json')).then(()=>true,()=>false),false,'settings never create a project JSON');
  for(const s of context.subscriptions)s?.dispose?.();
  // Simulate an extension-host restart with serialized workspace storage.
  for(const [key,value]of store)if(value!==undefined)store.set(key,JSON.parse(JSON.stringify(value)));
  const reopenedContext={...context,subscriptions:[] as any[]};module.exports.activate(reopenedContext);await commands.get('latexPro.open')();await receive!({type:'ready'});const recoveredAfterRestart=sent.filter(m=>m.type==='content').at(-1);assert.ok(recoveredAfterRestart.recoveredText.includes('Resume me after restart.'));
  await receive!({type:'history',action:'redo'});assert.ok((store.get('draft:'+fileUri.toString()) as any).text.includes('B changed from writing.'),'redo resumes after a real host recreation');assert.equal(await readFile(file,'utf8'),mapSaved);
  // Full-document editing keeps one transaction across files and validates all files before saving.
  await receive!({type:'projectDiscard',files:['main.tex']});
  const appendix=path.join(root,'appendix.tex'),appendixUri=uri(appendix);await writeFile(appendix,'Appendix original.\n');
  vscode.workspace.findFiles=async()=>[fileUri,appendixUri];await receive!({type:'reload'});await commands.get('latexPro.bind')();
  await receive!({type:'projectRead',requestId:'all'});const full=sent.filter(m=>m.type==='projectContent').at(-1);assert.equal(full.files.length,2);
  await receive!({type:'previewContext',requestId:77});const metadata=sent.filter(m=>m.type==='previewContext').at(-1);assert.equal(metadata.requestId,77);assert.ok(metadata.context.macros&&metadata.context.labels);
  await writeFile(path.join(root,'plot.pdf'),'fixture');await receive!({type:'assets',file:'sections/chapter.tex',names:['plot'],requestId:'root-image'});assert.equal(sent.filter(m=>m.type==='assets'&&m.requestId==='root-image').at(-1).assets.length,1,'nested sections resolve images relative to the project root');
  const draftChanges=full.files.map((f:any)=>({file:f.file,base:f.base,before:f.text,text:f.text+'Full draft.\n'}));
  await receive!({type:'projectDraft',changes:draftChanges});assert.equal(await readFile(appendix,'utf8'),'Appendix original.\n');
  await receive!({type:'history',action:'undo'});assert.equal(store.get('draft:'+appendixUri.toString()),undefined,'undo clears all files in the transaction');
  await receive!({type:'history',action:'redo'});assert.ok((store.get('draft:'+appendixUri.toString()) as any).text.includes('Full draft.'));
  for(const d of documents)d.isClosed=true;await writeFile(appendix,'External appendix.\n');const mainBefore=await readFile(file,'utf8');
  await receive!({type:'projectSave',changes:draftChanges});assert.equal(await readFile(file,'utf8'),mainBefore,'a conflict in the second file must not partially save the first');assert.equal(await readFile(appendix,'utf8'),'External appendix.\n');
  for(const d of documents)d.isClosed=true;await writeFile(appendix,'Appendix original.\n');
  await receive!({type:'projectSave',changes:draftChanges});assert.equal(await readFile(file,'utf8'),draftChanges.find((c:any)=>c.file==='main.tex').text);assert.equal(await readFile(appendix,'utf8'),'Appendix original.\nFull draft.\n');
  await receive!({type:'history',action:'undo'});assert.equal(await readFile(file,'utf8'),mainBefore);assert.equal(await readFile(appendix,'utf8'),'Appendix original.\n');
  await receive!({type:'history',action:'redo'});
  await receive!({type:'projectRead',requestId:'saved'});const savedFiles=sent.filter(m=>m.type==='projectContent').at(-1).files;
  const conflicts=savedFiles.map((f:any,i:number)=>({file:f.file,base:f.base,before:i?'stale':f.text,text:f.text+'Keep conflicting draft.\n'}));
  await receive!({type:'projectDraft',changes:conflicts});await receive!({type:'projectRead',requestId:'conflicts'});const recovery=sent.filter(m=>m.type==='projectContent').at(-1);assert.ok(recovery.files.every((f:any)=>f.conflict&&f.text.includes('Keep conflicting draft.')),'all proposed contents are recoverable when one file conflicts');
  await receive!({type:'projectDiscard',files:savedFiles.map((f:any)=>f.file)});await receive!({type:'projectRead',requestId:'discarded'});assert.ok(sent.filter(m=>m.type==='projectContent').at(-1).files.every((f:any)=>!f.conflict));
  // Automatic tag changes preserve an existing body draft and have a separate undo step.
  const bodyDisk=await readFile(file,'utf8'),bodyDraft=bodyDisk+'Body draft survives metadata.\n';await receive!({type:'draft',file:'main.tex',base:bodyDisk,text:bodyDraft});await receive!({type:'unitPatch',file:'main.tex',id:'file:main.tex',patch:{status:'draft',tag:'初稿',time:'2026-11-14T00:00:00Z'}});assert.equal(await readFile(file,'utf8'),bodyDisk,'metadata must not implicitly save body edits');assert.ok((store.get('draft:'+fileUri.toString()) as any).text.includes('初稿'));await receive!({type:'history',action:'undo'});assert.equal((store.get('draft:'+fileUri.toString()) as any).text,bodyDraft);await receive!({type:'history',action:'redo'});assert.ok((store.get('draft:'+fileUri.toString()) as any).text.includes('Body draft survives metadata.'));
  for(const s of reopenedContext.subscriptions)s?.dispose?.();

 }finally{await rm(root,{recursive:true,force:true});}
});
