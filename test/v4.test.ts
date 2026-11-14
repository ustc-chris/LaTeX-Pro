import test from 'node:test';
import assert from 'node:assert/strict';
import {composeEdits} from '../src/ai-model';
import {packRows,layoutDocument} from '../src/layout';
import {scanFile,updateUnit} from '../src/model';
import {buildDocumentTree} from '../src/document';
import {AiManager} from '../src/ai';
test('candidate edits preserve offsets, reject ambiguous, overlapping and out-of-scope replacements',()=>{
 assert.equal(composeEdits('abc def ghi',[{before:'def',after:'XYZ'},{before:'ghi',after:'123'}],[{start:4,end:11}]),'abc XYZ 123');
 assert.throws(()=>composeEdits('aa aa',[{before:'aa',after:'b'}],[{start:0,end:5}]),/不唯一/);
 assert.throws(()=>composeEdits('abcdef',[{before:'abc',after:'x'},{before:'bcde',after:'y'}],[{start:0,end:6}]),/重叠/);
 assert.throws(()=>composeEdits('abcdef',[{before:'abc',after:'x'}],[{start:3,end:6}]),/范围/);
});
test('row packing preserves order, contains every rectangle and avoids overlap at varied dimensions',()=>{
 for(let count=1;count<40;count++){const items=Array.from({length:count},(_,i)=>({width:120+(i*83)%320,height:80+(i*59)%240,x:0,y:0}));const result=packRows(items);for(let i=0;i<items.length;i++){const a=items[i];assert.ok(a.x>=0&&a.y>=0&&a.x+a.width<=result.width+.01&&a.y+a.height<=result.height+.01);if(i)assert.ok(a.y>items[i-1].y||a.x>items[i-1].x);for(const b of items.slice(i+1))assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y);}}
});
test('nested layout is deterministic and all child boxes stay inside their parents',()=>{
 const text='\\section{A}\n% !lp begin {"id":"a","title":"A"}\ntext\n% !lp end\n\\section{B}\n% !lp begin {"id":"b","title":"B"}\ntext\n% !lp end\n';const forest=buildDocumentTree([scanFile('main.tex',text)],'main.tex');const boxes=layoutDocument(forest);assert.deepEqual(boxes,layoutDocument(forest));const visit=(items:ReturnType<typeof layoutDocument>)=>{for(const b of items){for(const c of b.children)assert.ok(c.x>=0&&c.y>=0&&c.x+c.width<=b.width&&c.y+c.height<=b.height);visit(b.children);}};visit(boxes);
});
test('file status belongs to the root and does not overwrite the last heading status',()=>{
 const text='\\section{A}\n% !lp begin {"id":"a","title":"A"}\ntext\n% !lp end\n';const updated=updateUnit(text,'main.tex','file:main.tex',{status:'final',tag:'终稿'}),scan=scanFile('main.tex',updated);assert.equal(scan.units[0].status,'final');assert.equal(scan.units[1].status,'todo');
});
test('queued requirements keep their original source and reject changed targets before connecting',async()=>{
 let text='% !lp begin {"id":"a","title":"A"}\noriginal\n% !lp end\n';const manager=new AiManager({root:()=>'/tmp',executable:()=>'',read:async()=>text,persist:async()=>{},changed:()=>{},log:()=>{}});
 try{await manager.updateRequirement({file:'main.tex',unitId:'fragment:a',title:'A',instruction:'Improve'});const r=manager.state.requirements[0];assert.equal(r.source,'original\n');text=text.replace('original','changed');await assert.rejects(manager.submit({text:'',requirementIds:[r.id]}),/原文已变化/);assert.equal(r.status,'pending');}finally{manager.dispose();}
});

import {renamePlan,reverseChanges} from '../src/rename';
import {replacementText} from '../src/find';
test('renaming a TeX file updates include paths, preserves comments and can be reversed',()=>{
 const docs=[{file:'main.tex',text:'\\input{sections/old}\n% \\input{sections/old}\n'},{file:'sections/old.tex',text:'Body\n'},{file:'sections/other.tex',text:'\\include{old.tex}\n'}];const changes=renamePlan(docs,'sections/old.tex','sections/new.tex');assert.equal(changes[0].after,'\\input{sections/new}\n% \\input{sections/old}\n');assert.equal(changes[1].renameTo,'sections/new.tex');assert.equal(changes[2].after,'\\include{new.tex}\n');assert.equal(reverseChanges(changes)[1].file,'sections/new.tex');assert.equal(reverseChanges(changes)[1].renameTo,'sections/old.tex');assert.throws(()=>renamePlan(docs,'sections/old.tex','elsewhere/new.tex'),/同一目录/);
});
test('regex single replacement expands captures without losing lookbehind context',()=>{const source='alpha 12 beta',match=[...source.matchAll(/(?<=alpha )(?<num>\d+)/g)][0];assert.equal(replacementText('$<num>-$&-$$',match,source),'12-12-$');const grouped=[...source.matchAll(/(alpha) (\d+)/g)][0];assert.equal(replacementText('$2:$1',grouped,source),'12:alpha');});
