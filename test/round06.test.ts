import test from 'node:test';
import assert from 'node:assert/strict';
import {parseBibliography,attachCitationUses} from '../src/bibliography';
import {diffLines,diffHunks} from '../src/text-diff';
import {replacePreviewRange} from '../src/webview/preview-edit';
import {forwardPoint} from '../src/sync';
import {unitLabels,targetLabel} from '../src/unit-context';
import {scanFile} from '../src/model';
import {buildDocumentTree} from '../src/document';
test('BibTeX handles nested braces, quoted values, macros, offsets and citation usage',()=>{
 const source='% header\n@string{journal = "Physical Review"}\n@article{key, title={A {Nested} Title}, author="Alice and Bob", journal=journal # { D}, year=2026, doi={10.1/a}}\n@book{other,title="Other"}';const result=parseBibliography('bib/paper.bib',source);assert.deepEqual(result.issues,[]);assert.equal(result.entries.length,2);const entry=result.entries[0];assert.equal(entry.fields.title,'A Nested Title');assert.equal(entry.fields.journal,'Physical Review D');assert.equal(source.slice(entry.start,entry.end),entry.source);attachCitationUses(result.entries,[{file:'main.tex',text:'% \\cite{key}\nText \\citep[see][p.2]{key, other}'}]);assert.equal(entry.uses.length,1);assert.equal(entry.uses[0].line,2);assert.equal(result.entries[1].uses.length,1);assert.match(parseBibliography('bad.bib','@article{bad,title={broken}').issues[0],/未闭合/);
});
test('line diff reconstructs both files, groups edits and stays bounded for repeated lines',()=>{
 for(const [before,after]of [['a\nb\nc','a\nB\nc'],['','new'],['old',''],['a\na\na','a\nx\na'],['one\ntwo\nthree','zero\none\nthree\nfour']]){const lines=diffLines(before,after);assert.equal(lines.filter(l=>l.kind!=='add').map(l=>l.text).join('\n'),before);assert.equal(lines.filter(l=>l.kind!=='remove').map(l=>l.text).join('\n'),after);assert.ok(diffHunks(lines).length);}
 assert.equal(diffHunks(diffLines('same','same')).length,0);const before=Array(20000).fill('repeat').join('\n'),after=before+'\nend';const start=performance.now();assert.equal(diffLines(before,after).filter(l=>l.kind==='add').length,1);assert.ok(performance.now()-start<1500);
});
test('cross-paragraph preview replacement preserves metadata and surrounding LaTeX wrappers',()=>{
 const source='First paragraph.\n\n% !lp meta {"status":"draft"}\n\\textbf{Second paragraph.}';const first={id:0,kind:'text' as const,start:0,end:16,source:'First paragraph.'},start=source.indexOf('Second'),second={id:1,kind:'text' as const,start,end:start+17,source:'Second paragraph.'};const result=replacePreviewRange(source,{start:6,end:start+6},'replacement',[first,second]);assert.match(result,/% !lp meta/);assert.match(result,/\\textbf\{/);assert.ok(result.includes('First replacement'));assert.ok(!result.includes('Second'));assert.ok(result.endsWith(' paragraph.}'));assert.equal(replacePreviewRange('abc',{start:1,end:1},'X',[]),'aXbc');
});
test('SyncTeX uses the top of the bounding box and retains highlight dimensions',()=>{assert.deepEqual(forwardPoint('SyncTeX result begin\nPage:2\nx:40\ny:212\nh:30\nv:220\nW:310\nH:12\nSyncTeX result end'),{page:2,x:30,y:208,width:310,height:12});});
test('human-readable scope labels identify paragraph, section and selected-text targets',()=>{const parsed=scanFile('main.tex','\\section{Intro}\n% !lp begin {"id":"a","title":"Motivation"}\nBody\n% !lp end\n'),labels=unitLabels(buildDocumentTree([parsed],'main.tex')),unit=parsed.units.find(u=>u.id==='fragment:a')!;assert.match(labels.get('main.tex\0'+unit.id)!.short,/段 Motivation \[第1节 Intro\]/);assert.match(targetLabel(unit,labels),/针对本段落修改/);assert.match(targetLabel(unit,labels,true),/针对所选文字修改/);});

test('SyncTeX preserves result priority when one response contains multiple candidates',()=>{const output='SyncTeX result begin\nOutput:paper.pdf\nPage:2\nx:30\ny:40\nOutput:paper.pdf\nPage:7\nx:100\ny:600\nSyncTeX result end';assert.equal(forwardPoint(output).page,2);assert.equal(forwardPoint(output).y,40);});

test('preview deletion preserves complete escaped glyph boundaries',()=>{const source='A \\& B',token={id:0,kind:'text' as const,start:2,end:4,source:'\\&',value:'&'};assert.equal(replacePreviewRange(source,{start:3,end:4},'', [token]),'A  B');});
