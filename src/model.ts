export const statuses=['todo','draft','final'] as const;
export type Status=typeof statuses[number];
export const statusNames:Record<Status,string>={todo:'待编写',draft:'初稿',final:'定稿'};
export const statusColors:Record<Status,string>={todo:'#9ba3ac',draft:'#dc9a42',final:'#528dce'};
export function normalizeStatus(s:unknown):Status{return s==='final'||s==='done'?'final':s==='draft'||s==='ai-draft'||s==='human-draft'||s==='review'?'draft':'todo';}
export function defaultTag(s:unknown):string{return ({'ai-draft':'AI初稿','human-draft':'人工初稿',review:'待审核',done:'定稿'} as Record<string,string>)[String(s)]||statusNames[normalizeStatus(s)];}
export interface Unit{id:string;title:string;kind:'file'|'chapter'|'section'|'subsection'|'subsubsection'|'abstract'|'fragment';file:string;start:number;end:number;parent?:string;status?:Status;tag?:string;time?:string;note?:string;summary?:string;unmarked?:boolean;contentType?:'段'|'图'|'表';metaStart?:number;metaEnd?:number;titleStart?:number;titleEnd?:number}
export interface ScanFile{path:string;units:Unit[];references:string[];includes?:{target:string;offset:number}[];structuralHeadings?:Unit[];issues:string[]}
export interface Settings{latexTools?:import('./compilation').LatexTool[];latexRecipes?:import('./compilation').LatexRecipe[];latexRecipe?:string;latexOutDir?:string;agent?:import('./agent-discovery').AgentConfiguration;aiAgent?:import('./agent-discovery').AgentName;aiPrompt?:string;historyLimit?:number;debug?:boolean;projectName:string;mainFile:string;pdfFile:string;autoScan:boolean;fontSize:number;wordWrap:boolean;defaultLayout:'source'|'split'|'pdf';previewWidth:number;previewFontSize?:number;defaultView?:'structure'|'work'|'references'|'ai'|'compile';compiler?:'pdflatex'|'xelatex'|'lualatex'|'custom';compilerCommand?:string;compilerArgs?:string[];theme?:'system'|'light'|'dark';aiCodexPath?:string;editorTheme?:Record<string,string>;editorFontFamily?:string}
export interface Snapshot{bound:boolean;project:string;files:ScanFile[];settings:Settings;mainFile:string;scannedAt:string;issues:string[];scanMs?:number}
export function kindLabel(u:Unit):string{return u.kind==='fragment'?(u.contentType||'段'):({file:'文件',chapter:'章',section:'节',subsection:'目',subsubsection:'目',abstract:'摘要'})[u.kind];}
export function levelOf(u:Unit):number{return u.kind==='chapter'?0:u.kind==='section'||u.kind==='abstract'||u.kind==='file'?1:u.kind==='fragment'?3:2;}
export function maskNonCode(text:string):string{return text.replace(/\\begin\{(verbatim\*?|lstlisting|minted)\}[\s\S]*?\\end\{\1\}/g,m=>m.replace(/[^\r\n]/g,' ')).replace(/(?<!\\)%[^\r\n]*/g,m=>' '.repeat(m.length));}
export function plainText(t:string){return t.replace(/(?<!\\)%[^\n]*/g,'').replace(/\\(?:label|ref|cite|includegraphics)(?:\[[^\]]*\])?\{[^}]*\}/g,'').replace(/\\(?:begin|end)\{[^}]*\}/g,'').replace(/\\[a-zA-Z]+\*?/g,'').replace(/[{}$]/g,'').replace(/\s+/g,' ').trim();}
function metadata(m:any){const status=normalizeStatus(m.status);return {status,tag:typeof m.tag==='string'?m.tag:defaultTag(m.status),time:typeof m.time==='string'?m.time:undefined,note:typeof m.note==='string'?m.note:''};}
export function scanFile(file:string,text:string):ScanFile{
 const root:Unit={id:`file:${file}`,title:file,kind:'file',file,start:0,end:text.length,status:'todo',tag:'待编写'};
 const result:ScanFile={path:file,units:[root],references:[],includes:[],issues:[]};let offset=0,active:Unit|undefined,verbatim=false,hasMarker=false;
 const stack:{level:number;unit:Unit}[]=[];let latest:Unit=root;
 for(const line of text.match(/[^\n]*\n|[^\n]+$/g)||[]){
  const begin=line.match(/^\s*%\s*!lp\s+begin\s+(\{.*\})\s*$/),meta=line.match(/^\s*%\s*!lp\s+meta\s+(\{.*\})\s*$/),end=/^\s*%\s*!lp\s+end\s*$/.test(line);
  if(!verbatim&&begin){hasMarker=true;try{const m=JSON.parse(begin[1]);if(typeof m.id!=='string'||!m.id.trim()||typeof m.title!=='string'||!m.title.trim())throw Error('需要 id 和 title');if(active)throw Error('片段不允许嵌套');if(result.units.some(u=>u.id===`fragment:${m.id}`))throw Error('片段 ID 重复');if(m.status!==undefined&&!['todo','draft','final','ai-draft','human-draft','review','done'].includes(m.status))throw Error('未知状态');active={id:`fragment:${m.id}`,title:m.title,kind:'fragment',file,start:offset+line.length,end:text.length,parent:stack.at(-1)?.unit.id||root.id,...metadata(m),metaStart:offset,metaEnd:offset+line.length};result.units.push(active);}catch(e){result.issues.push(`${file}: ${String(e)}`);}}
  else if(!verbatim&&meta){try{const m=JSON.parse(meta[1]);Object.assign(latest,metadata(m),{metaStart:offset,metaEnd:offset+line.length});if(m.id)latest.id=String(m.id);}catch{result.issues.push(`${file}: 元数据无效`);}}
  else if(!verbatim&&end){if(active){active.end=offset;active=undefined;}else result.issues.push(`${file}: 孤立的 !lp end`);}
  else{
   const code=line.replace(/(?<!\\)%.*/,'');if(/\\begin\{(?:verbatim\*?|lstlisting|minted)\}/.test(code))verbatim=true;
   if(!verbatim){for(const m of code.matchAll(/\\(?:input|include)\s*\{([^}]+)\}/g)){result.references.push(m[1]);result.includes!.push({target:m[1],offset:offset+m.index!});}
    const h=code.match(/^\s*\\(chapter|section|subsection|subsubsection)\*?(?:\[[^\]]*\])?\s*\{/);const abs=/^\s*\\begin\{abstract\}/.test(code);
    if(h||abs){let title='摘要',a=0,b=0;const kind=(h?h[1]:'abstract') as Unit['kind'];const level=['chapter','section','subsection','subsubsection'].indexOf(kind);if(h){a=h[0].length;let d=1;b=a;for(;b<code.length;b++){if(code[b]==='\\'){b++;continue;}if(code[b]==='{')d++;if(code[b]==='}'&&!--d)break;}title=plainText(code.slice(a,b));}
     while(stack.length&&stack.at(-1)!.level>=level)stack.pop()!.unit.end=offset;
     latest={id:`${file}:heading:${offset}`,title,kind,file,start:offset,end:text.length,parent:stack.at(-1)?.unit.id||root.id,status:'todo',tag:'待编写',...(h?{titleStart:offset+a,titleEnd:offset+b}:{})};result.units.push(latest);stack.push({level,unit:latest});
    }
    if(/\\end\{abstract\}/.test(code)&&stack.at(-1)?.unit.kind==='abstract')stack.pop()!.unit.end=offset+line.length;
   }
   if(/\\end\{(?:verbatim\*?|lstlisting|minted)\}/.test(code))verbatim=false;
  }offset+=line.length;
 }
 if(active)result.issues.push(`${file}: 片段 ${active.title} 缺少 !lp end`);root.unmarked=!hasMarker;
 for(const u of result.units){if(u.kind==='fragment'){const body=text.slice(u.start,u.end);u.summary=plainText(body).slice(0,180);u.contentType=/\\begin\{(?:table\*?|tabular)\}/.test(body)?'表':/\\(?:includegraphics)|\\begin\{figure/.test(body)?'图':'段';}}
 if(!hasMarker&&!result.references.length){result.structuralHeadings=result.units.slice(1);result.units=[root];}
 return result;
}
export function normalizeRelative(value:string):string{const out:string[]=[];if(value.startsWith('/')||/^[A-Za-z]:/.test(value))throw Error('请使用项目内的相对路径');for(const p of value.replaceAll('\\','/').split('/')){if(p==='..'){if(!out.length)throw Error('路径不能越出项目');out.pop();}else if(p&&p!=='.')out.push(p);}return out.join('/');}
export function updateUnit(text:string,file:string,id:string,patch:{title?:string;status?:Status;tag?:string;time?:string}):string{
 const parsed=scanFile(file,text);const u=[...parsed.units,...(parsed.structuralHeadings||[])].find(u=>u.id===id);if(!u)throw Error('内容已改变，请刷新后重试');
 if(patch.title!==undefined&&(!patch.title.trim()||/[\r\n{}\\]/.test(patch.title)))throw Error('标题不能为空，且不能包含 LaTeX 控制字符');
 const edits:{start:number;end:number;text:string}[]=[];
 if(patch.title!==undefined&&u.kind!=='fragment'){if(u.titleStart===undefined)throw Error('此项标题不可修改');edits.push({start:u.titleStart,end:u.titleEnd!,text:patch.title});}
 if(u.metaStart!==undefined){const original=text.slice(u.metaStart,u.metaEnd);const json=original.match(/\{.*\}/)![0];const m={...JSON.parse(json),...patch};if(u.kind!=='fragment')delete m.title;edits.push({start:u.metaStart,end:u.metaEnd!,text:`% !lp ${u.kind==='fragment'?'begin':'meta'} ${JSON.stringify(m)}\n`});}
 else if(patch.status!==undefined||patch.tag!==undefined){const at=u.kind==='file'?0:text.indexOf('\n',u.start)+1;const pos=u.kind==='file'?0:(at||text.length);const m={status:patch.status||u.status||'todo',tag:patch.tag||u.tag||'待编写',time:patch.time};edits.push({start:pos,end:pos,text:`${u.kind==='file'||at?'':'\n'}% !lp meta ${JSON.stringify(m)}\n`});}
 for(const e of edits.sort((a,b)=>b.start-a.start))text=text.slice(0,e.start)+e.text+text.slice(e.end);return text;
}
