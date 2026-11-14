import test from 'node:test';
import assert from 'node:assert/strict';
import {configurationIssue} from '../src/configuration';
test('project config accepts VS Code JSONC and names the file/line for real errors',()=>{
 assert.equal(configurationIssue('{// optional settings\n"latexPro.mainFile":"main.tex",\n}','settings.json'),undefined);
 assert.match(configurationIssue('{\n"latexPro.mainFile":\n}','/project/.vscode/settings.json')!,/\/project\/\.vscode\/settings.json 第 3 行格式错误/);
 assert.match(configurationIssue('[]','settings.json')!,/必须是 JSON 对象/);
});

import {completeConfiguration,isMissingConfiguration} from '../src/configuration';
import {parse} from 'jsonc-parser';
test('old project JSONC gets missing keys without changing explicit values, unrelated settings or comments',()=>{
 const old='{\n// user comment\n"editor.fontSize":18,\n"latexPro.wordWrap":false,\n}';const next=completeConfiguration(old,{wordWrap:true,historyLimit:335,aiAgent:'codex'}),value=parse(next);assert.equal(value['latexPro.wordWrap'],false);assert.equal(value['latexPro.historyLimit'],335);assert.equal(value['editor.fontSize'],18);assert.ok(next.includes('// user comment'));assert.equal(completeConfiguration(next,{wordWrap:true,historyLimit:335,aiAgent:'codex'}),next);assert.equal(completeConfiguration('{invalid',{historyLimit:335}),'{invalid');assert.equal(isMissingConfiguration({message:'Unable to read settings: FileNotFound'}),true);assert.equal(isMissingConfiguration({code:'EACCES'}),false);
});
