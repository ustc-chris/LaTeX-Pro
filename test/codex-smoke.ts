// Run explicitly: node --import tsx test/codex-smoke.ts (uses the signed-in local Codex).
import {AiManager} from '../src/ai';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
async function main(){
const root=await mkdtemp(path.join(tmpdir(),'lp-codex-smoke-'));
const text='% !lp begin {"id":"smoke","title":"Smoke"}\nThe result are precise.\n% !lp end\n';await writeFile(path.join(root,'main.tex'),text);
let done:()=>void=()=>{};const completed=new Promise<void>(resolve=>done=resolve);
const manager=new AiManager({root:()=>root,executable:()=>'',read:async()=>text,persist:async()=>{},changed:state=>{const s=state.sessions[0];if(s&&!s.running&&s.messages.length)done();},log:()=>{}});
try{await manager.connect();console.log('Connected; models:',manager.state.models.length);await manager.submit({text:'Correct only the grammar in the provided sentence. Return exactly one replacement. Do not use any tools.',targets:[{file:'main.tex',unitId:'fragment:smoke',title:'Smoke'}]});await Promise.race([completed,new Promise((_,reject)=>setTimeout(()=>reject(Error('AI smoke timed out')),90000).unref())]);const s=manager.state.sessions[0];if(s.error)throw Error(s.error);if(s.candidates.length!==1||!s.candidates[0].after.includes('The result is precise.'))throw Error('Unexpected candidate');console.log('PASS: real Codex generated a candidate; original remains unchanged.');}finally{manager.dispose();await rm(root,{recursive:true,force:true});}

}
void main().catch(e=>{console.error(String(e));process.exitCode=1;});
