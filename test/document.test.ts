import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scanFile} from '../src/model';
import {automaticPdf,buildDocumentTree,flattenTree,searchDocuments} from '../src/document';
const fragment=(id:string,status='ai-draft')=>`% !lp begin {"id":"${id}","title":"${id}","status":"${status}"}\n研究背景 ${id}\n% !lp end\n`;
test('included subsections are contained in the section at their include site',()=>{
  const files=[scanFile('main.tex','\\input{sections/chapter}\n'),scanFile('sections/chapter.tex','\\section{Chapter}\n'+fragment('intro')+'\\input{sections/child}\n'),scanFile('sections/child.tex','\\subsection{Method}\n'+fragment('method','done'))];
  const tree=buildDocumentTree(files,'main.tex');assert.equal(tree.length,1);assert.equal(tree[0].unit.title,'Chapter');assert.equal(tree[0].children[1].unit.title,'Method');assert.equal(tree[0].children[1].children[0].unit.id,'fragment:method');assert.equal(tree[0].counts.draft,1);assert.equal(tree[0].counts.final,1);
});
test('an unmarked section containing includes still parents its subsections',()=>{
  const files=[scanFile('main.tex','\\input{chapter}\n'),scanFile('chapter.tex','\\section{Chapter}\\label{sec:chapter}\n\\input{child}\n'),scanFile('child.tex','\\subsection{Method}\n'+fragment('method'))];
  const tree=buildDocumentTree(files,'main.tex');assert.equal(tree[0].unit.title,'Chapter');assert.equal(tree[0].children[0].unit.title,'Method');assert.equal(tree[0].children[0].children[0].unit.id,'fragment:method');
});
test('an included heading without fragments remains visible in the document tree',()=>{
  const files=[scanFile('main.tex','\\input{chapter}'),scanFile('chapter.tex','\\section{Chapter}\n\\input{empty}'),scanFile('empty.tex','\\subsection{Future work}\n')];
  const tree=buildDocumentTree(files,'main.tex');assert.equal(tree[0].children[0].unit.title,'Future work');
});
test('relative includes, cycles, and unreferenced files do not duplicate or misparent nodes',()=>{
  const files=[scanFile('main.tex','\\input{parts/chapter}'),scanFile('parts/chapter.tex','\\section{One}\n'+fragment('a')+'\\input{child}\n\\input{../main}'),scanFile('parts/child.tex','\\subsection{Child}\n'+fragment('b')),scanFile('notes.tex','\\section{Unmarked}\nnotes')];
  const tree=buildDocumentTree(files,'main.tex');assert.equal(flattenTree(tree).filter(n=>n.unit.kind==='fragment').length,2);assert.equal(tree.at(-1)!.unit.file,'notes.tex');assert.equal(tree.at(-1)!.unit.unmarked,true);
});
test('literal full-text search preserves Unicode offsets and picks the smallest fragment',()=>{
  const text='前言 😀\r\n\\section{背景}\r\n'+fragment('intro')+'[x] E=mc^2';const result=searchDocuments([{file:'a.tex',text},{file:'b.tex',text:'研究背景'}],'研究背景');assert.equal(result.hits.length,2);const h=result.hits[0];assert.equal(text.slice(h.start,h.end),'研究背景');assert.equal(h.unit?.id,'fragment:intro');assert.equal(h.column,1);assert.equal(searchDocuments([{file:'a',text}],'[x]').hits.length,1);
});
test('search handles case sensitivity, empty queries, and a result cap',()=>{
  const docs=[{file:'a',text:'AI ai Ai'}];assert.equal(searchDocuments(docs,'ai').hits.length,3);assert.equal(searchDocuments(docs,'ai',true).hits.length,1);assert.equal(searchDocuments(docs,'').hits.length,0);assert.equal(searchDocuments(docs,'ai',false,2).truncated,true);
});
test('PDF always resolves at the project root from the entry basename',()=>{
  assert.equal(automaticPdf('src/paper.tex'),'paper.pdf');assert.equal(automaticPdf('main.tex'),'main.pdf');assert.equal(automaticPdf(''),'');
});
