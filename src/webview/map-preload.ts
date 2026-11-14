import {preloadReadPreview} from './useReadPreview';
import {mapKey,getMapDocument} from './map-documents';
import {scanFile} from '../model';
const revisions=new Map<string,{text:string;assets:string}>();
export function prepareFilePreview(file:string,text:string,assets:Record<string,string>,revision:string){const encoded=JSON.stringify(assets),old=revisions.get(file);if(old?.text===text&&old.assets===encoded)return;revisions.set(file,{text,assets:encoded});const parsed=scanFile(file,text);for(const unit of [...parsed.units,...(parsed.structuralHeadings||[])]){const key=mapKey(file,unit.id),doc=getMapDocument(key),source=doc.dirty?doc.text:text.slice(unit.start,unit.end);const own:Record<string,string>={};for(const m of source.matchAll(/\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}/g))if(assets[m[1]])own[m[1]]=assets[m[1]];preloadReadPreview(key,source,own,false,{file,offset:unit.start});}}
