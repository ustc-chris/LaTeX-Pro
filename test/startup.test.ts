import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {startupHtml} from '../src/startup';
const require=createRequire(import.meta.url),{JSDOM}=require('jsdom');
const options={nonce:'test-nonce',cspSource:'http://localhost',css:'http://localhost/app.css',script:'http://localhost/app.js',assets:{version:'0.4.5'},firstStart:true};
test('first-run shell is visible before resources or host data, and uses a single VS Code API',async()=>{
 const messages:any[]=[];let acquired=0;const dom=new JSDOM(startupHtml(options),{runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w:any){w.acquireVsCodeApi=()=>{acquired++;return {postMessage:(m:any)=>messages.push(m),getState:()=>null,setState:()=>{}};};}});
 try{const w=dom.window,doc=w.document;assert.ok(doc.getElementById('lp-startup'));assert.equal(doc.getElementById('root').hidden,true);assert.equal(doc.querySelector('link'),null,'external stylesheet cannot block the initial shell');assert.ok(doc.body.textContent.includes('首次初始化'));
  await new Promise(r=>w.setTimeout(r,80));assert.ok(messages.some(m=>m.type==='shellPainted'));assert.equal(acquired,1);assert.equal(doc.querySelector('script[type="module"]').src,options.script);
  w.dispatchEvent(new w.MessageEvent('message',{data:{type:'startupStage',message:'正在打开当前文档…'}}));assert.equal(doc.getElementById('lp-startup-stage').textContent,'正在打开当前文档…');
  w.LATEX_PRO_BOOT.finish();assert.ok(doc.getElementById('lp-startup'),'keep shell until CSS and host initialization are ready');doc.querySelector('link').dispatchEvent(new w.Event('load'));assert.equal(doc.getElementById('lp-startup'),null);assert.equal(doc.getElementById('root').hidden,false);assert.equal(messages.filter(m=>m.type==='appDisplayed').length,1);w.LATEX_PRO_BOOT.finish();assert.equal(messages.filter(m=>m.type==='appDisplayed').length,1);
 }finally{dom.window.close();}
});
test('resource errors leave a visible explanation and report through VS Code',async()=>{
 const messages:any[]=[];const dom=new JSDOM(startupHtml({...options,firstStart:false}),{runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w:any){w.acquireVsCodeApi=()=>({postMessage:(m:any)=>messages.push(m)});}});
 try{const w=dom.window;assert.ok(w.document.body.textContent.includes('正在打开工作区'));await new Promise(r=>w.setTimeout(r,80));w.document.querySelector('link').dispatchEvent(new w.Event('error'));assert.ok(w.document.getElementById('lp-startup-stage').textContent.includes('VS Code 通知'));assert.ok(messages.some(m=>m.type==='startupError'));assert.ok(w.document.getElementById('lp-startup'));}finally{dom.window.close();}
});
