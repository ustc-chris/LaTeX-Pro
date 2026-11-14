import * as vscode from 'vscode';
import * as path from 'node:path';
import {parse} from 'jsonc-parser/lib/esm/main.js';
export async function editorColors():Promise<Record<string,string>>{
 const selected=vscode.workspace.getConfiguration('workbench').get<string>('colorTheme'),rules:any[]=[];
 const load=async(uri:vscode.Uri,depth=0):Promise<void>=>{if(depth>6)return;const value=parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)));if(value.include)await load(vscode.Uri.joinPath(uri,'..',value.include),depth+1);if(Array.isArray(value.tokenColors))rules.push(...value.tokenColors);};
 for(const ext of vscode.extensions.all){const theme=ext.packageJSON.contributes?.themes?.find((t:any)=>t.id===selected||t.label===selected);if(theme){try{await load(vscode.Uri.joinPath(ext.extensionUri,theme.path));}catch{}break;}}
 const custom=vscode.workspace.getConfiguration('editor').get<any>('tokenColorCustomizations')||{};rules.push(...(custom.textMateRules||[]),...(custom[`[${selected}]`]?.textMateRules||[]));
 const groups:Record<string,string[]>={comment:['comment'],keyword:['keyword','storage'],string:['string'],number:['constant.numeric'],'type.identifier':['support.function','support.class','entity.name.function','entity.name.section'],delimiter:['punctuation']},result:Record<string,string>={};
 for(const [token,scopes]of Object.entries(groups))for(const rule of rules){const names=Array.isArray(rule.scope)?rule.scope:String(rule.scope||'').split(',').map((s:string)=>s.trim());if(rule.settings?.foreground&&names.some((n:string)=>scopes.some(s=>n===s||n.startsWith(s+'.'))))result[token]=rule.settings.foreground;}
 return result;
}
