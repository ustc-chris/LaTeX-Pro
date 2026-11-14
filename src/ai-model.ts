export interface AiSelection{start:number;end:number;source:string}
export interface EditRequirement{id:string;file:string;unitId:string;title:string;instruction:string;status:'pending'|'submitted';sessionId?:string;source?:string;selection?:AiSelection}
export interface AiMessage{role:'user'|'assistant';text:string;time:string}
export interface AiCandidate{id:string;file:string;before:string;after:string;status:'pending'|'applied'|'rejected';messageIndex?:number}
export interface AiSession{id:string;title:string;threadId?:string;model?:string;effort?:string;messages:AiMessage[];candidates:AiCandidate[];createdAt:string;running?:boolean;turnId?:string;activity?:string;targets?:{file:string;unitId:string;title:string;selection?:AiSelection}[];error?:string;stream?:string}
export interface AiState{connected:boolean;account?:string;models:{id:string;name:string;isDefault?:boolean;efforts?:{id:string;description:string}[];defaultEffort?:string}[];defaultModel?:string;defaultEffort?:string;sessions:AiSession[];requirements:EditRequirement[]}
export function composeEdits(base:string,edits:{before:string;after:string}[],ranges:{start:number;end:number}[]):string{
 const replacements=edits.map(e=>{if(!e.before||typeof e.after!=='string')throw Error('AI 返回了无效的修改');const start=base.indexOf(e.before);if(start<0||base.indexOf(e.before,start+1)>=0)throw Error('AI 修改位置不唯一，请缩小目标后重试');const end=start+e.before.length;if(!ranges.some(r=>start>=r.start&&end<=r.end))throw Error('AI 修改超出了选定内容范围');return {start,end,text:e.after};}).sort((a,b)=>a.start-b.start);
 for(let i=1;i<replacements.length;i++)if(replacements[i].start<replacements[i-1].end)throw Error('AI 修改范围重叠');
 for(const e of replacements.reverse())base=base.slice(0,e.start)+e.text+base.slice(e.end);return base;
}
