import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,rename} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {ProjectGit} from '../src/project-git';
const exec=promisify(execFile);
test('project Git creates its own init, never reuses parent, preserves existing repositories and supports manual diff/commit',async()=>{
 const parent=await mkdtemp(path.join(tmpdir(),'lp-git-'));
 try{
  await exec('git',['init',parent]);const root=path.join(parent,'paper');await mkdir(root);await writeFile(path.join(root,'正文.tex'),'original 中文\n');await writeFile(path.join(root,'main.aux'),'temporary');await writeFile(path.join(root,'main.pdf'),Buffer.from([0,1,2]));
  const git=new ProjectGit(root);await git.ensure();const initial=await git.state();assert.equal(initial.history.length,1);assert.equal(initial.history[0].subject,'init');assert.ok(initial.tracked.includes('正文.tex'));assert.ok(initial.tracked.includes('main.pdf'));assert.ok(!initial.tracked.includes('main.aux'));assert.deepEqual(initial.files,[]);
  assert.equal((await exec('git',['-C',parent,'rev-parse','--verify','HEAD']).catch(()=>({stdout:''}))).stdout,'','parent has no commits');
  await git.ensure();assert.equal((await git.state()).head,initial.head);await writeFile(path.join(root,'正文.tex'),'changed 中文\n');const diff=await git.diff('正文.tex');assert.equal(diff.before,'original 中文\n');assert.equal(diff.after,'changed 中文\n');assert.equal((await git.diff('main.pdf')).binary,true);
  await git.commit('改进正文');assert.equal((await git.state()).history[0].subject,'改进正文');assert.equal((await git.diff('正文.tex',initial.head)).before,'original 中文\n');await assert.rejects(()=>git.commit('empty'),/没有可提交/);
  const oldIgnore=(await git.state()).ignore;await git.saveIgnore(oldIgnore+'private/\n',oldIgnore);await assert.rejects(()=>git.saveIgnore('stale',oldIgnore),/其他程序/);assert.ok((await readFile(path.join(root,'.gitignore'),'utf8')).endsWith('private/\n'));
  await git.commit('ignore');await rename(path.join(root,'正文.tex'),path.join(root,'重命名.tex'));await exec('git',['-C',root,'add','-A']);const renamed=await git.diff('重命名.tex');assert.equal(renamed.before,'changed 中文\n');assert.equal(renamed.after,'changed 中文\n');await git.commit('rename');assert.equal((await git.diff('重命名.tex',initial.head)).before,'original 中文\n','historical diff follows renames');await rm(path.join(root,'重命名.tex'));assert.equal((await git.diff('重命名.tex')).after,'');
  await assert.rejects(()=>git.diff('../escape'),/当前项目/);await assert.rejects(()=>git.diff('x','HEAD;bad'),/版本标识/);await symlink(path.join(parent,'outside'),path.join(root,'link'));await writeFile(path.join(parent,'outside'),'secret');await assert.rejects(()=>git.diff('link'),/越出项目/);
 }finally{await rm(parent,{recursive:true,force:true});}
});
test('existing ignore is kept and gitfile pointing to an external repository is rejected',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'lp-git-existing-'));try{await writeFile(path.join(root,'.gitignore'),'custom\n');const git=new ProjectGit(root);await git.ensure();assert.equal((await git.state()).ignore,'custom\n');const head=(await git.state()).head;await writeFile(path.join(root,'new.tex'),'new');await git.ensure();assert.equal((await git.state()).head,head);await rm(path.join(root,'.git'),{recursive:true});await writeFile(path.join(root,'.git'),'gitdir: ../external');await assert.rejects(()=>git.ensure(),/独立仓库/);}finally{await rm(root,{recursive:true,force:true});}
});
