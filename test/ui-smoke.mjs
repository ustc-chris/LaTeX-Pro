import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile,mkdir,access,readdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {scanFile}=require('../dist/test-model.cjs');
const {searchDocuments,buildDocumentTree}=require('../dist/test-document.cjs');
const base=resolve('examples/demo');
const paths=['main.tex','notes.tex','sections/introduction.tex','sections/results.tex'];
const texts=Object.fromEntries(await Promise.all(paths.map(async p=>[p,await readFile(resolve(base,p),'utf8')])));
const snapshot={bound:false,project:'demo',files:paths.map(p=>scanFile(p,texts[p])),settings:{projectName:'demo',mainFile:'main.tex',pdfFile:'main.pdf',autoScan:true,fontSize:14,wordWrap:true,defaultLayout:'source',previewWidth:760},mainFile:'main.tex',scannedAt:new Date().toISOString(),issues:[]};
const server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/dist/webview.css"></head><body><div id="root"></div><script>window.LATEX_PRO_ASSETS={worker:"/dist/pdf.worker.mjs",cmaps:"/dist/cmaps/",fonts:"/dist/standard_fonts/"}</script><script src="/dist/webview.js"></script></body></html>');return;}
  const p=resolve('.'+url.pathname);if(!p.startsWith(resolve('.')+'/'))throw Error('outside');
  res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.ttf':'font/ttf','.pdf':'application/pdf'})[extname(p)]||'application/octet-stream');res.end(await readFile(p));
}catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let executablePath=chromium.executablePath();
if(!await access(executablePath).then(()=>true).catch(()=>false))executablePath='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser=await chromium.launch({headless:true,executablePath});
let page;
try{
  page=await browser.newPage({viewport:{width:1450,height:1000}});const errors=[];page.setDefaultTimeout(9000);page.on('pageerror',e=>errors.push(String(e)));
  await page.exposeFunction('hostSearch',({query,caseSensitive,currentText,currentFile})=>searchDocuments(paths.map(file=>({file,text:file===currentFile?currentText:texts[file]})),query,caseSensitive));
  await page.addInitScript(({snapshot,texts})=>{
    window.__messages=[];window.__texts=texts;window.__snapshot=snapshot;window.__version=1;window.__current='';window.__stored={};
    const emit=m=>{const data=structuredClone(m);setTimeout(()=>window.dispatchEvent(new MessageEvent('message',{data})),10);};
    const content=()=>emit({type:'content',file:window.__current,text:window.__texts[window.__current],version:window.__version,uri:'file:///'+window.__current,readonly:!window.__snapshot.bound});
    window.acquireVsCodeApi=()=>({getState:()=>undefined,setState:s=>window.__stored=s,postMessage:async m=>{
      window.__messages.push(m);
      if(m.type==='ready')emit({type:'snapshot',snapshot:window.__snapshot});
      if(m.type==='bind'){window.__snapshot.bound=true;emit({type:'snapshot',snapshot:window.__snapshot});}
      if(m.type==='open'){window.__current=m.file;content();}
      if(m.type==='save'){window.__texts[window.__current]=m.text;window.__version++;content();emit({type:'saved'});}
      if(m.type==='settings'){window.__snapshot.settings=m.settings;window.__snapshot.project=m.settings.projectName||'demo';emit({type:'snapshot',snapshot:window.__snapshot});emit({type:'settingsSaved'});}
      if(m.type==='assets')emit({type:'assets',assets:m.names.map(name=>({name,url:'/examples/demo/figures/workflow.svg'}))});
      if(m.type==='fullText')emit({type:'fullText',text:Object.values(window.__texts).join('\n')});
      if(m.type==='pdf')emit({type:'pdf',url:'/examples/demo/main.pdf',revision:Date.now()});
      if(m.type==='search'){const result=await window.hostSearch({...m,currentFile:window.__current});emit({type:'searchResults',requestId:m.requestId,...result});}
    }});
  },{snapshot,texts});
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.getByText('当前为代码查看模式。',{exact:false}).waitFor();assert.equal(await page.locator('.brand').count(),0);
  assert.deepEqual(await page.locator('.topbar nav button').allTextContents(),['文档结构','写作台']);
  assert.equal(await page.locator('.topbar nav').getByRole('button',{name:'文档结构',exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'绑定项目',exact:true}).click();await page.getByRole('button',{name:'手动扫描',exact:true}).waitFor();
  await page.locator('aside .outline-content').filter({hasText:'研究动机'}).click();await page.locator('.monaco-editor').waitFor();
  await page.waitForFunction(()=>document.querySelector('select[aria-label="内容层级"]').value==='fragment:intro-motivation');
  assert.ok(await page.locator('aside .outline-content').filter({hasText:'结果汇总'}).count());
  const resizer=page.getByRole('separator',{name:'调整大纲宽度'});const bb=await resizer.boundingBox();const oldWidth=(await page.locator('aside').boundingBox()).width;await page.mouse.move(bb.x+2,bb.y+120);await page.mouse.down();await page.mouse.move(bb.x+92,bb.y+120);await page.mouse.up();assert.ok((await page.locator('aside').boundingBox()).width>oldWidth+70);
  await page.getByRole('button',{name:'切换大纲侧栏'}).click();assert.equal(await page.locator('aside').count(),0);await page.getByRole('button',{name:'切换大纲侧栏'}).click();
  await page.getByLabel('内容层级').selectOption('file');await page.getByRole('button',{name:'快速预览',exact:true}).click();await page.locator('article .katex').first().waitFor();
  await page.locator('aside .outline-content').filter({hasText:'结果汇总'}).click();await page.getByLabel('内容层级').selectOption('file');await page.getByRole('button',{name:'快速预览',exact:true}).click();await page.locator('article table').waitFor();await page.locator('article img').waitFor();assert.equal(await page.locator('article table tr').count(),3);
  await page.getByRole('button',{name:'源码',exact:true}).last().click();await page.getByLabel('内容层级').selectOption('fragment:results-table');
  const code=page.locator('.monaco-editor textarea').first();await code.focus();await page.keyboard.press('Meta+A');await page.keyboard.insertText('修改后的片段\n');await page.keyboard.insertText('第二行\n');await page.getByRole('button',{name:'保存',exact:true}).click();await page.getByText('已保存',{exact:true}).waitFor();
  const edited=await page.evaluate(()=>window.__texts['sections/results.tex']);assert.ok(edited.includes('修改后的片段\n第二行\n% !lp end'));assert.ok(edited.includes('\\subsection{示意图}'));
  await code.focus();await page.keyboard.insertText('再次编辑\n');await page.getByRole('button',{name:'保存',exact:true}).click();await page.waitForFunction(()=>window.__messages.filter(m=>m.type==='save').length===2);assert.deepEqual(await page.evaluate(()=>window.__messages.filter(m=>m.type==='save').map(m=>m.version)),[1,2]);
  await page.keyboard.press('Meta+Shift+f');await page.getByRole('dialog',{name:'全文搜索',exact:true}).waitFor();await page.getByLabel('搜索全文').fill('我们希望');await page.locator('.search-result').first().waitFor();assert.match(await page.locator('.search-group h3').first().innerText(),/introduction/);await page.locator('.search-result').first().click();await page.waitForFunction(()=>document.querySelector('select[aria-label="内容层级"]').value==='fragment:intro-motivation');await page.locator('.monaco-editor .selected-text').first().waitFor();
  await page.getByRole('button',{name:'项目设置',exact:true}).click();const dialog=page.getByRole('dialog',{name:'设置',exact:true});assert.equal(await dialog.locator('h2,header').count(),0);assert.ok((await dialog.boundingBox()).x>800);await dialog.getByLabel('项目名称',{exact:true}).fill('demo');await page.getByRole('button',{name:'保存设置',exact:true}).click();await page.locator('.project-pill').filter({hasText:'demo'}).waitFor();
  await page.getByRole('button',{name:'源码 + PDF',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.pdf-pane canvas')?.width>100);await page.getByRole('button',{name:'PDF 设置',exact:true}).click();assert.equal(await page.getByRole('dialog').getByRole('textbox').count(),0);await page.getByRole('button',{name:'关闭设置',exact:true}).click();await page.getByRole('button',{name:'锁定页面',exact:true}).click();await page.getByRole('button',{name:'已锁定',exact:true}).waitFor();await page.screenshot({path:'/tmp/latex-pro-v2-writing.png'});
  await page.locator('.topbar nav').getByRole('button',{name:'文档结构',exact:true}).click();assert.equal(await page.locator('aside').count(),0);assert.equal(await page.locator('.structure-head,.stats').count(),0);await page.locator('.document-tile').first().waitFor();await page.locator('.react-flow__minimap-node').first().waitFor();assert.equal(await page.locator('.react-flow__edge').count(),0);
  await page.getByRole('button',{name:'统计信息',exact:true}).click();await page.getByRole('dialog',{name:'文档统计',exact:true}).waitFor();await page.getByRole('button',{name:'关闭统计',exact:true}).click();
  await page.screenshot({path:'/tmp/latex-pro-v2-overview.png'});
  // Two-finger scrolling pans; a Ctrl+wheel event models a trackpad pinch.
  const viewport=page.locator('.react-flow__viewport');const before=await viewport.getAttribute('style');await page.mouse.move(1000,400);await page.mouse.wheel(80,50);await page.waitForFunction(old=>document.querySelector('.react-flow__viewport').getAttribute('style')!==old,before);
  const oldScale=await viewport.evaluate(el=>Number(el.style.transform.match(/scale\(([^)]+)\)/)[1]));await page.keyboard.down('Control');await page.mouse.wheel(0,-90);await page.keyboard.up('Control');await page.waitForFunction(old=>Number(document.querySelector('.react-flow__viewport').style.transform.match(/scale\(([^)]+)\)/)[1])>old,oldScale);
  for(let i=0;i<3;i++){const zoomIn=page.locator('.react-flow__controls-zoomin');if(await zoomIn.isEnabled())await zoomIn.click();}await page.locator('.document-tile.subsection .document-tile.fragment').first().waitFor();
  const nested=page.locator('.document-tile.fragment[data-unit-id="fragment:intro-motivation"]');const tileBox=await nested.boundingBox();await page.mouse.move(1100,600);await page.mouse.wheel((tileBox.x+tileBox.width/2-380)*2,(tileBox.y+tileBox.height/2-340)*2);await nested.click({button:'right'});await page.getByRole('menu').waitFor();await page.getByRole('menuitem',{name:'在写作台编辑',exact:true}).click();await page.waitForFunction(()=>document.querySelector('select[aria-label="内容层级"]').value==='fragment:intro-motivation');
  await page.locator('.topbar nav').getByRole('button',{name:'文档结构',exact:true}).click();await page.locator('.document-tile.subsection .document-tile.fragment').first().waitFor();await page.screenshot({path:'/tmp/latex-pro-v2-map.png'});
  const again=page.locator('.document-tile.fragment[data-unit-id="fragment:intro-motivation"]');await again.click();assert.ok((await again.getAttribute('class')).includes('selected'));await again.dblclick();await page.waitForFunction(()=>document.querySelector('select[aria-label="内容层级"]').value==='fragment:intro-motivation');
  assert.deepEqual(errors,[]);console.log('PASS v2: outline hierarchy/resize/toggle; scoped save; shortcut search and exact highlight; name/settings placement; auto PDF; nested boxes; minimap; stats popup; trackpad pan; context editing; no page errors');
}catch(e){if(page)await page.screenshot({path:'/tmp/latex-pro-v2-failure.png'}).catch(()=>{});throw e;}finally{await browser.close();await new Promise(r=>server.close(r));}
