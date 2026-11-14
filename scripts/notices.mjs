import {readFile,writeFile} from 'node:fs/promises';
const lock=JSON.parse(await readFile('package-lock.json','utf8'));
let out='LaTeX Pro — third-party notices\nRuntime dependencies and their bundled license texts.\n\n';
for(const [location,meta]of Object.entries(lock.packages||{})){
  if(!location||meta.dev)continue;
  try{const pkg=JSON.parse(await readFile(location+'/package.json','utf8'));out+=`\n${'='.repeat(72)}\n${pkg.name} ${pkg.version}\nLicense: ${typeof pkg.license==='string'?pkg.license:JSON.stringify(pkg.license)}\n`;
    for(const file of ['LICENSE','LICENSE.md','LICENSE.txt','license','license.md','license.txt','ThirdPartyNotices.txt']){try{out+=`\n${await readFile(location+'/'+file,'utf8')}\n`;}catch{}}
  }catch{}
}
await writeFile('THIRD_PARTY_NOTICES.txt',out);
