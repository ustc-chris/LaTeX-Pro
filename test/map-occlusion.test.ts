import test from 'node:test';
import assert from 'node:assert/strict';
import {titleShield,clipRect} from '../src/map-occlusion';
import {documentPrefixes,measureBox,layoutDocument} from '../src/layout';
import type {Unit} from '../src/model';
import type {DocumentNode} from '../src/document';
const frame={left:0,top:0,right:200,bottom:100},title={left:8,top:8,right:100,bottom:25},status={left:8,top:30,right:60,bottom:40};
test('title shields compare heading areas with descendant outer frames and stop at frame bounds',()=>{
 assert.equal(titleShield([title,status],[],frame),null,'no descendant frame needs no shield');
 assert.equal(titleShield([title,status],[{left:10,top:55,right:100,bottom:70}],frame),null);
 assert.equal(titleShield([title],[{left:100,top:8,right:150,bottom:25}],frame),null);
 assert.deepEqual(titleShield([title,status],[{left:30,top:32,right:100,bottom:45}],frame),{solid:40,height:60});
 assert.equal(titleShield([{left:8,top:120,right:100,bottom:140}],[{left:8,top:120,right:100,bottom:140}],frame),null,'clipped text does not trigger a shield');
 assert.deepEqual(titleShield([{left:8,top:90,right:100,bottom:120}],[{left:20,top:95,right:80,bottom:100}],frame),{solid:100,height:100});
 assert.deepEqual(titleShield([title,status],[{left:20,top:20,right:150,bottom:95}],frame),{solid:40,height:60},'a frame triggers protection without any child text in the heading');
 assert.equal(clipRect(title,{left:0,top:30,right:200,bottom:100}),null);
});
test('paragraph badges omit numbers, subsection names are readable, other counters remain separate',()=>{
 const node=(key:string,kind:Unit['kind'],contentType?:Unit['contentType']):DocumentNode=>({key,unit:{id:key,kind,file:'main.tex',title:key,start:0,end:1,contentType},children:[],counts:{todo:0,draft:0,final:0}});
 const nodes=[node('s','section'),node('ss','subsection'),node('sss','subsubsection'),node('p1','fragment'),node('p2','fragment'),node('fig','fragment','图')];
 assert.deepEqual([...documentPrefixes(nodes).values()],['sec 1','sub sec 1','sub sub sec 1','段','段','fig 1']);
});

test('map groups reserve more heading room and larger sibling gaps than paragraphs',()=>{
 const node=(key:string,kind:Unit['kind'],children:DocumentNode[]=[]):DocumentNode=>({key,unit:{id:key,kind,file:'main.tex',title:key,start:0,end:1},children,counts:{todo:0,draft:0,final:0}});
 const section=(id:string)=>node(id,'section',[node(id+'a','fragment'),node(id+'b','fragment')]);const root=node('root','file',[section('s1'),section('s2')]);const box=measureBox(root);assert.ok(box.children.every(c=>c.y>=84&&c.x>=24));
 const gap=(a:{x:number;y:number;width:number;height:number},b:{x:number;y:number;width:number;height:number})=>Math.max(a.x-b.x-b.width,b.x-a.x-a.width,a.y-b.y-b.height,b.y-a.y-a.height);assert.ok(gap(box.children[0],box.children[1])>=26);assert.ok(gap(box.children[0].children[0],box.children[0].children[1])>=18);const roots=layoutDocument([root,node('other','file')]);assert.ok(gap(roots[0],roots[1])>=40);
});
