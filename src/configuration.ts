import {parse,type ParseError,printParseErrorCode} from 'jsonc-parser/lib/esm/main.js';
export function configurationIssue(text:string,file:string):string|undefined{
 const errors:ParseError[]=[];const value=parse(text,errors,{allowTrailingComma:true,disallowComments:false});if(errors.length){const first=errors[0],line=text.slice(0,first.offset).split('\n').length;return `${file} 第 ${line} 行格式错误：${printParseErrorCode(first.error)}。请修复后重新保存。`;}
 if(!value||typeof value!=='object'||Array.isArray(value))return `${file} 必须是 JSON 对象。`;return undefined;
}

import {modify,applyEdits} from 'jsonc-parser/lib/esm/main.js';
// Only add our own absent keys. Existing values, unrelated settings and comments survive.
export function completeConfiguration(text:string,values:Record<string,unknown>){if(configurationIssue(text,'settings.json'))return text;const value=parse(text);for(const [key,current]of Object.entries(values)){const name='latexPro.'+(({latexTools:'latex.tools',latexRecipes:'latex.recipes',latexRecipe:'latex.recipe.default',latexOutDir:'latex.outDir'} as Record<string,string>)[key]||key);if(current!==undefined&&!Object.prototype.hasOwnProperty.call(value,name))text=applyEdits(text,modify(text,[name],current,{formattingOptions:{insertSpaces:true,tabSize:2,eol:'\n'}}));}return text;}
export function isMissingConfiguration(error:any){return ['ENOENT','FileNotFound','EntryNotFound'].includes(error?.code)||/ENOENT|FileNotFound|EntryNotFound/i.test(String(error?.message||''));}
