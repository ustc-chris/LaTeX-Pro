import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
export async function run(){
  const log:string[]=[];
  try{
    const ext=vscode.extensions.getExtension('latex-pro-local.latex-pro');assert.ok(ext);await ext.activate();log.push('extension activated');
    const commands=await vscode.commands.getCommands();for(const c of ['latexPro.open','latexPro.bind','latexPro.structure','latexPro.search'])assert.ok(commands.includes(c));log.push('commands registered');
    const root=vscode.workspace.workspaceFolders![0].uri;
    await vscode.commands.executeCommand('latexPro.bind');
    assert.equal(vscode.workspace.getConfiguration('latexPro',root).get('mainFile'),'main.tex');log.push('workspace bound and main file selected');
    const doc=await vscode.workspace.openTextDocument(vscode.Uri.joinPath(root,'sections/introduction.tex'));
    await vscode.window.showTextDocument(doc);await vscode.commands.executeCommand('latexPro.open');log.push('workbench opened');
    await vscode.commands.executeCommand('vscode.openWith',doc.uri,'latexPro.editor');log.push('custom editor opened');
    await vscode.commands.executeCommand('latexPro.structure');log.push('structure opened');
    await writeFile('/tmp/latex-pro-host-result.json',JSON.stringify({ok:true,log}));
  }catch(e){await writeFile('/tmp/latex-pro-host-result.json',JSON.stringify({ok:false,log,error:String(e)}));throw e;}
}
