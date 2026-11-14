export interface GitFile{path:string;status:string;oldPath?:string}
export interface GitCommit{hash:string;shortHash:string;author:string;time:string;subject:string}
export interface GitState{root:string;branch:string;head:string;files:GitFile[];tracked:string[];history:GitCommit[];ignore:string;available:boolean}
export interface DiffView{title:string;file:string;before:string;after:string;kind:'git'|'ai';binary?:boolean;sessionId?:string;candidateId?:string;candidateStatus?:'pending'|'applied'|'rejected'}
export function parseGitStatus(raw:string):GitFile[]{const chunks=raw.split('\0'),files:GitFile[]=[];for(let i=0;i<chunks.length;i++){const record=chunks[i];if(!record)continue;const status=record.slice(0,2),path=record.slice(3);if(!path)continue;const renamed=/[RC]/.test(status);files.push({path,status,...(renamed?{oldPath:chunks[++i]}:{})});}return files;}
export const defaultGitignore=`# LaTeX compilation\n*.aux\n*.log\n*.out\n*.toc\n*.lof\n*.lot\n*.nav\n*.snm\n*.vrb\n*.fls\n*.fdb_latexmk\n*.synctex\n*.synctex.gz\n*.xdv\n*.dvi\n*.blg\n# Local caches and editor temporary files\n.latex-pro/cache/\nnode_modules/\n*.swp\n*.swo\n*~\n.DS_Store\nThumbs.db\n`;
