export interface TextRect{left:number;top:number;right:number;bottom:number}
export function clipRect(a:TextRect,b:TextRect):TextRect|null{const r={left:Math.max(a.left,b.left),top:Math.max(a.top,b.top),right:Math.min(a.right,b.right),bottom:Math.min(a.bottom,b.bottom)};return r.right>r.left&&r.bottom>r.top?r:null;}
// Protect the heading area against descendant outer frames, even if their text is hidden.
export function titleShield(own:TextRect[],below:TextRect[],frame:TextRect):{solid:number;height:number}|null{
 const protectedText=own.map(r=>clipRect(r,frame)).filter((r):r is TextRect=>!!r);
 if(!protectedText.some(a=>below.some(b=>!!clipRect(a,b))))return null;
 const solid=Math.max(...protectedText.map(r=>r.bottom))-frame.top;
 return {solid,height:Math.min(frame.bottom-frame.top,solid+20)};
}
