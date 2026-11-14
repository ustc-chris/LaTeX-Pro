import test from 'node:test';
import assert from 'node:assert/strict';
import {StartupDebug,summarizeProfile,type CpuProfile} from '../src/diagnostics';

test('CPU summary attributes native leaf frames to the calling extension and separates idle time',()=>{
 const profile:CpuProfile={startTime:0,endTime:20000,nodes:[{id:1,callFrame:{functionName:'(root)',url:'',lineNumber:-1},children:[2,4]},{id:2,callFrame:{functionName:'activate',url:'file:///extensions/slow%20plugin/main.js',lineNumber:9},children:[3]},{id:3,callFrame:{functionName:'parse',url:'',lineNumber:-1}},{id:4,callFrame:{functionName:'(idle)',url:'',lineNumber:-1}}],samples:[3,3,4],timeDeltas:[5000,10000,5000]};
 const summary=summarizeProfile(profile,[{id:'sample.slow',path:'/extensions/slow plugin'}]);assert.equal(summary.durationMs,20);assert.equal(summary.topExtensions[0].id,'sample.slow');assert.equal(summary.topExtensions[0].ms,15);assert.equal(summary.topExtensions[0].percent,75);assert.equal(summary.topExtensions[1].id,'(idle)');assert.equal(summary.topFrames[0].function,'parse');
});
test('disabled debug records no details and starts no profiler',async()=>{
 const lines:string[]=[],files:string[]=[];const debug=new StartupDebug({enabled:()=>false,write:s=>lines.push(s),extensions:()=>[],save:async name=>{files.push(name);return name;}});try{debug.event('private-test');await debug.start();await debug.stop();assert.deepEqual(lines,[]);assert.deepEqual(files,[]);}finally{debug.dispose();}
});
test('enabled debug captures a real local CPU profile and saves a readable summary',async()=>{
 const lines:string[]=[],files=new Map<string,string>();const debug=new StartupDebug({enabled:()=>true,write:s=>lines.push(s),extensions:()=>[],save:async(name,data)=>{files.set(name,new TextDecoder().decode(data));return '/logs/'+name;}});
 try{await debug.start();let sum=0;const started=performance.now();while(performance.now()-started<60)for(let i=0;i<5000;i++)sum+=Math.sqrt(i);assert.ok(sum>0);await debug.stop();assert.ok(lines.some(s=>s.includes('cpu-profile.started')),lines.join('\n'));const profile=[...files].find(([name])=>name.endsWith('.cpuprofile'));assert.ok(profile);assert.ok(JSON.parse(profile[1]).samples.length>0);const summary=[...files].find(([name])=>name.endsWith('.json'));assert.ok(summary);assert.ok(JSON.parse(summary[1]).durationMs>0);assert.ok(lines.some(s=>s.includes('cpu-profile.saved')));}finally{debug.dispose();}
});
