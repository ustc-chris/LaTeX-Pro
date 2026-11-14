import * as esbuild from 'esbuild';
import {mkdir,copyFile,cp,writeFile,rm} from 'node:fs/promises';
await rm('dist/chunks',{recursive:true,force:true});
await mkdir('dist',{recursive:true});
await esbuild.build({entryPoints:['src/extension.ts'],bundle:true,platform:'node',format:'cjs',external:['vscode'],outfile:'dist/extension.js',sourcemap:true});
const result=await esbuild.build({entryPoints:{webview:'src/webview/main.tsx'},bundle:true,platform:'browser',format:'esm',splitting:true,outdir:'dist',chunkNames:'chunks/[name]-[hash]',minify:true,define:{'process.env.NODE_ENV':'"production"'},loader:{'.ttf':'file','.woff':'file','.woff2':'file','.svg':'file','.png':'file','.gif':'file'},assetNames:'assets/[name]-[hash]',metafile:true});
await writeFile('dist/bundle-stats.json',JSON.stringify(Object.fromEntries(Object.entries(result.metafile.outputs).map(([k,v])=>[k,v.bytes])),null,2));
await copyFile('node_modules/pdfjs-dist/build/pdf.worker.min.mjs','dist/pdf.worker.mjs');
for(const dir of ['cmaps','standard_fonts','wasm'])await cp('node_modules/pdfjs-dist/'+dir,'dist/'+dir,{recursive:true});
