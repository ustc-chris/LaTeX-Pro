import test from 'node:test';
import assert from 'node:assert/strict';
import {configuredHostAffinity,planHostIsolation,removeHostIsolation} from '../src/host-isolation';
const id='latex-pro-local.latex-pro';
test('assigns an exclusive host group without copying unrelated user settings to the workspace',()=>{
 const effective={'other.extension':1,'another.extension':3},local={'local.extension':3};const result=planHostIsolation(effective,local);assert.equal(result.affinity,2);assert.deepEqual(result.value,{'local.extension':3,[id]:2});assert.deepEqual(effective,{'other.extension':1,'another.extension':3});
});
test('keeps an existing exclusive group stable and requests no redundant setting write',()=>{
 const settings={[id]:4,'other.extension':2};const result=planHostIsolation(settings,settings);assert.equal(result.affinity,4);assert.equal(result.changed,false);
});
test('moves out of a group shared with another extension and preserves its configuration',()=>{
 const settings={[id]:1,'other.extension':1};const result=planHostIsolation(settings,settings);assert.equal(result.affinity,2);assert.equal(result.value['other.extension'],1);
});
test('preserves an existing case-insensitive extension key and handles malformed maps',()=>{
 const result=planHostIsolation({'LaTeX-Pro-Local.LaTeX-Pro':3},{});assert.deepEqual(result.value,{'LaTeX-Pro-Local.LaTeX-Pro':3});assert.equal(configuredHostAffinity(result.value),3);assert.deepEqual(planHostIsolation(null,[]).value,{[id]:1});
});
test('removal affects only this extension in workspace settings and removes an empty map',()=>{
 assert.deepEqual(removeHostIsolation({[id]:3,'other.extension':2}),{'other.extension':2});assert.equal(removeHostIsolation({[id]:3}),undefined);
});
