import {normalizeRelative,scanFile,statuses,type Status,type ScanFile,type Unit} from './model';
export function automaticPdf(mainFile:string):string{return mainFile?mainFile.split('/').at(-1)!.replace(/\.tex$/i,'.pdf'):'';}
export interface DocumentNode {key:string;unit:Unit;children:DocumentNode[];counts:Record<Status,number>}
export function emptyCounts():Record<Status,number>{return {todo:0,draft:0,final:0};}
export function flattenTree(nodes:DocumentNode[]):DocumentNode[]{return nodes.flatMap(n=>[n,...flattenTree(n.children)]);}

// Follow input/include in source order: a subsection in another file belongs to
// the section active at its include site, rather than to an unrelated file node.
export function buildDocumentTree(files:ScanFile[],mainFile:string):DocumentNode[]{
  const byPath=new Map(files.map(f=>[f.path,f]));const roots:DocumentNode[]=[];const seen=new Set<string>();
  let stack:{level:number;node:DocumentNode}[]=[];
  const add=(unit:Unit)=>{const node:DocumentNode={key:`${unit.file}::${unit.id}`,unit,children:[],counts:emptyCounts()};const levels:Partial<Record<Unit['kind'],number>>={chapter:0,section:1,subsection:2,subsubsection:3,abstract:1};const level=levels[unit.kind];
    if(level!==undefined)while(stack.length&&stack.at(-1)!.level>=level)stack.pop();
    (stack.at(-1)?.node.children||roots).push(node);if(level!==undefined)stack.push({level,node});return node;
  };
  const resolve=(from:string,target:string)=>{try{const name=target.endsWith('.tex')?target:target+'.tex';const local=normalizeRelative(from.split('/').slice(0,-1).concat(name).join('/'));return byPath.has(name)?name:local;}catch{return '';}};
  const visit=(file:string,included=false)=>{if(seen.has(file))return;const f=byPath.get(file);if(!f)return;seen.add(file);
    const refs=f.includes||f.references.map((target,i)=>({target,offset:f.units[0].end+i}));
    if(f.units[0].unmarked&&!refs.length&&!(included&&f.structuralHeadings?.length)){add(f.units[0]);return;}
    const units=included&&f.structuralHeadings?.length?f.structuralHeadings:f.units.slice(1);
    const events=[...units.map(unit=>({offset:unit.start,unit:unit as Unit|undefined,target:''})),...refs.map(r=>({offset:r.offset,unit:undefined as Unit|undefined,target:r.target}))].sort((a,b)=>a.offset-b.offset);
    for(const event of events)if(event.unit)add(event.unit);else visit(resolve(file,event.target),true);
    if(!events.length)add(f.units[0]);
  };
  if(mainFile)visit(mainFile);for(const f of files)if(!seen.has(f.path)){stack=[];visit(f.path);}
  const aggregate=(n:DocumentNode)=>{if(n.unit.kind==='fragment')n.counts[n.unit.status||'todo']++;for(const c of n.children){aggregate(c);for(const s of statuses)n.counts[s]+=c.counts[s];}};
  roots.forEach(aggregate);return roots;
}

export interface SearchHit {file:string;line:number;column:number;start:number;end:number;before:string;match:string;after:string;unit?:Unit}
export function searchDocuments(documents:{file:string;text:string}[],query:string,caseSensitive=false,limit=500):{hits:SearchHit[];truncated:boolean}{
  if(!query)return {hits:[],truncated:false};const hits:SearchHit[]=[];
  const escaped=query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');const regex=new RegExp(escaped,caseSensitive?'gu':'giu');
  for(const {file,text}of documents){const units=scanFile(file,text).units;const lineStarts=[0];for(let i=0;i<text.length;i++)if(text[i]==='\n')lineStarts.push(i+1);
    for(const m of text.matchAll(regex)){if(hits.length>=limit)return {hits,truncated:true};const start=m.index!,end=start+m[0].length;
      let lo=0,hi=lineStarts.length;while(lo+1<hi){const mid=(lo+hi)>>1;if(lineStarts[mid]<=start)lo=mid;else hi=mid;}
      const left=Math.max(lineStarts[lo],start-65),right=Math.min(text.indexOf('\n',end)===-1?text.length:text.indexOf('\n',end),end+100);
      const unit=units.filter(u=>u.start<=start&&u.end>=end).sort((a,b)=>(a.end-a.start)-(b.end-b.start))[0];
      hits.push({file,line:lo+1,column:start-lineStarts[lo]+1,start,end,before:text.slice(left,start),match:m[0],after:text.slice(end,right),unit});
    }
  }return {hits,truncated:false};
}
