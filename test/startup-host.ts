import * as vscode from 'vscode';
import {writeFile} from 'node:fs/promises';
export async function run(){
 const ext=vscode.extensions.getExtension('latex-pro-local.latex-pro')!;
 await ext.activate();
 const root=vscode.workspace.workspaceFolders![0].uri;
 await vscode.commands.executeCommand('latexPro.bind');
 const main=vscode.workspace.getConfiguration('latexPro',root).get<string>('mainFile')!;
 const doc=await vscode.workspace.openTextDocument(vscode.Uri.joinPath(root,main));
 await vscode.window.showTextDocument(doc);
 await vscode.commands.executeCommand('latexPro.open');
 const start=Date.now();
 while(Date.now()-start<15000){
  const timings=ext.exports.getStartupTimings();
  if(timings.some((t:{name:string})=>t.name==='editor ready')){await writeFile('/tmp/latex-pro-startup.json',JSON.stringify({ok:true,timings}));return;}
  await new Promise(r=>setTimeout(r,100));
 }
 await writeFile('/tmp/latex-pro-startup.json',JSON.stringify({ok:false,timings:ext.exports.getStartupTimings()}));
 throw Error('Editor did not become ready within 15 seconds');
}
