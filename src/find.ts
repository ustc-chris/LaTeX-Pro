// Expand replacement tokens using the original match, including lookbehind context.
export function replacementText(template:string,match:RegExpMatchArray,source:string):string{
 return template.replace(/\$(\$|&|`|'|\d{1,2}|<[^>]+>)/g,(token,key:string)=>{
  const at=match.index||0;if(key==='$')return '$';if(key==='&')return match[0];if(key==='`')return source.slice(0,at);if(key==="'")return source.slice(at+match[0].length);if(key.startsWith('<'))return match.groups?match.groups[key.slice(1,-1)]??'':token;const n=Number(key);if(n>0&&n<match.length)return match[n]??'';if(key.length===2&&+key[0]>0&&+key[0]<match.length)return (match[+key[0]]??'')+key[1];return token;
 });
}
