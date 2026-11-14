import test from 'node:test';
import assert from 'node:assert/strict';
import {scanFile} from '../src/model';
import {buildDocumentTree} from '../src/document';
import {semanticNodes,trackedSemantic} from '../src/writing-navigation';
test('semantic paths carry numbered ancestors and choose the paragraph at the editor top',()=>{const source='\\chapter{C}\n\\section{S}\n\\subsection{M}\n% !lp begin {"id":"one","title":"First"}\nFirst body\n% !lp end\n% !lp begin {"id":"two","title":"Second"}\nSecond body\n% !lp end\n';const nodes=semanticNodes(buildDocumentTree([scanFile('main.tex',source)],'main.tex')),point=trackedSemantic(nodes,'main.tex',source.indexOf('Second body'));assert.equal(point?.unit.id,'fragment:two');assert.match(point!.detail,/第1章 C.*第1节 S.*第1目 M.*第2段 Second/);assert.ok(point?.path.some(u=>u.kind==='section'));assert.equal(trackedSemantic(nodes,'other.tex',1),undefined);});
