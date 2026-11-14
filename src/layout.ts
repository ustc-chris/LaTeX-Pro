import type {DocumentNode} from './document';
export interface MapBox{node:DocumentNode;x:number;y:number;width:number;height:number;children:MapBox[]}
interface Size{width:number;height:number;x:number;y:number}
// Keep source order. Evaluate width limits, then choose row breaks by minimum unused area.
export function packRows<T extends Size>(items:T[],gap=16,aspect=1.6):{width:number;height:number}{
 if(!items.length)return {width:0,height:0};
 const max=Math.max(...items.map(b=>b.width)),area=items.reduce((a,b)=>a+b.width*b.height,0),ideal=Math.max(max,Math.sqrt(area*aspect));
 const limits=new Set([max,ideal]);for(const factor of [.65,.8,1,1.2,1.5,1.9,2.5])limits.add(Math.max(max,ideal*factor));
 let accum=0;for(const b of items.slice(0,12)){accum+=b.width+gap;limits.add(accum-gap);}
 let best:{score:number;width:number;height:number;rows:T[][]}|undefined;
 for(const width of limits){const n=items.length,cost=Array(n+1).fill(Infinity),previous=Array(n+1).fill(0);cost[0]=0;
  for(let end=1;end<=n;end++){let used=0,height=0,occupied=0;for(let start=end-1;start>=0;start--){const b=items[start];used+=b.width+(start<end-1?gap:0);if(used>width+.001)break;height=Math.max(height,b.height);occupied+=b.width*b.height;const value=cost[start]+width*(height+gap)-occupied;if(value<cost[end]){cost[end]=value;previous[end]=start;}}}
  const rows:T[][]=[];for(let end=n;end>0;){const start=previous[end];rows.unshift(items.slice(start,end));end=start;}
  const actualWidth=Math.max(...rows.map(r=>r.reduce((s,b)=>s+b.width+gap,-gap))),height=rows.reduce((s,r)=>s+Math.max(...r.map(b=>b.height))+gap,-gap);
  const envelope=actualWidth*height,ratio=Math.log(actualWidth/height/aspect),score=envelope-area+area*.32*ratio*ratio;
  if(!best||score<best.score)best={score,width:actualWidth,height,rows};
 }
 let y=0;for(const row of best!.rows){let x=0;for(const b of row){b.x=x;b.y=y;x+=b.width+gap;}y+=Math.max(...row.map(b=>b.height))+gap;}
 return {width:best!.width,height:best!.height};
}
export function measureBox(node:DocumentNode):MapBox{const children=node.children.map(measureBox),box:MapBox={node,x:0,y:0,width:250,height:150,children};if(!children.length)return box;const gap=children.some(c=>c.children.length)?26:18;const size=packRows(children,gap);for(const c of children){c.x+=24;c.y+=96;}box.width=Math.max(300,size.width+48);box.height=size.height+144;return box;}
export function layoutDocument(nodes:DocumentNode[]):MapBox[]{const boxes=nodes.map(measureBox);packRows(boxes,40,1.7);return boxes;}
export function documentPrefixes(nodes:DocumentNode[]):Map<string,string>{const result=new Map<string,string>(),counts:Record<string,number>={};const visit=(n:DocumentNode)=>{const u=n.unit,k=({chapter:'ch',section:'sec',subsection:'sub sec',subsubsection:'sub sub sec',abstract:'abs',file:'file',fragment:u.contentType==='图'?'fig':u.contentType==='表'?'tab':'段'})[u.kind];counts[k]=(counts[k]||0)+1;result.set(n.key,k==='段'?'段':k+' '+counts[k]);n.children.forEach(visit);};nodes.forEach(visit);return result;}
