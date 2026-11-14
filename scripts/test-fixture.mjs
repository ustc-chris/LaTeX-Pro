import {mkdtemp,copyFile,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
const target='/tmp/latex-pro-v3-fixture';
await mkdir(target,{recursive:true});
await copyFile('test/fixtures/sync/main.tex',target+'/main.tex');
let engine=process.env.LATEX_PRO_TEST_PDFLATEX||'pdflatex';
try{await run(engine,['--version']);}catch{
 engine='/Library/TeX/texbin/pdflatex';
 try{await run(engine,['--version']);}catch{throw Error('PDF 测试需要 pdflatex，请设置 LATEX_PRO_TEST_PDFLATEX 为完整路径。');}
}
for(let i=0;i<2;i++)await run(engine,['-interaction=nonstopmode','-halt-on-error','-synctex=1','main.tex'],{cwd:target});
