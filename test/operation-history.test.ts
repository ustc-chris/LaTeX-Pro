import test from 'node:test';
import assert from 'node:assert/strict';
import {OperationHistory,patchText,makePatch} from '../src/operation-history';
test('project history persists compact patches, coalesces typing, and preserves redo across restart',()=>{
 const h=new OperationHistory(undefined);h.record('work',[{file:'a.tex',before:'abc',after:'abcd'}],false,100);h.record('work',[{file:'a.tex',before:'abcd',after:'abcde'}],false,800);assert.equal(h.data.undo.length,1);
 const op=h.peek(false)!;assert.equal(patchText('abcde',op.changes[0].patch,false),'abc');assert.equal(op.changes[0].patch.before,'');
 h.complete(false);const restored=new OperationHistory(JSON.parse(JSON.stringify(h.data)));assert.equal(patchText('abc',restored.peek(true)!.changes[0].patch,true),'abcde');restored.complete(true);assert.equal(restored.data.undo.length,1);
 assert.throws(()=>patchText('external',op.changes[0].patch,false),/内容已变化/);
});
test('saving seals content edits, edits in different files remain ordered, limits cover undo plus redo',()=>{
 const h=new OperationHistory(undefined,10);h.record('map',[{file:'a.tex',id:'paragraph',before:'one',after:'two'}],false,0);assert.equal(h.peek(false)?.committed,undefined);h.markSaved('map','a.tex','paragraph');assert.equal(h.peek(false)?.committed,true);
 h.record('map',[{file:'a.tex',id:'paragraph',before:'two',after:'three'}],false,100);assert.equal(h.data.undo.length,2);assert.equal(h.peek(false)?.committed,undefined);
 for(let i=0;i<20;i++)h.record('work',[{file:i+'.tex',before:'',after:'x'}],false,1000+i);assert.equal(h.data.undo.length,10);h.complete(false);h.complete(false);assert.equal(h.data.redo.length,2);h.record('work',[{file:'new.tex',before:'',after:'y'}]);assert.equal(h.data.redo.length,0);
});
test('AI transaction and rename patches retain atomic targets and reverse correctly',()=>{
 const h=new OperationHistory(undefined);h.record('disk',[{file:'a.tex',before:'a',after:'b'},{file:'b.tex',before:'c',after:'d',renameTo:'c.tex'}],true);assert.equal(h.peek(false)?.ai,true);assert.equal(h.peek(false)?.changes.length,2);assert.equal(h.peek(false)?.changes[1].renameTo,'c.tex');
 const before='Large unchanged prefix\n'+'x'.repeat(200000)+'old tail';const p=makePatch(before,before.replace('old tail','new tail'));assert.ok(p.before.length+p.after.length<10);assert.equal(patchText(before,p,true),before.replace('old tail','new tail'));
});
