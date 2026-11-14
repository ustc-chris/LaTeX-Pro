import React,{createContext,useContext,memo} from 'react';
import type {MiniMapNodeProps} from '@xyflow/react';
import type {MapBox} from '../layout';
import {statusColors} from '../model';
export const MiniMapBoxes=createContext<ReadonlyMap<string,MapBox>>(new Map());
const MiniBox=memo(function MiniBox({box,root=false}:{box:MapBox;root?:boolean}){const color=statusColors[box.node.unit.status||'todo'];return <g transform={`translate(${root?0:box.x},${root?0:box.y})`}><rect className="minimap-detail" data-unit-id={box.node.unit.id} data-kind={box.node.unit.kind} width={box.width} height={box.height} rx={Math.min(8,box.height/8)} fill={color} fillOpacity={box.children.length ? .1 : .32} stroke={color} strokeOpacity={.9} strokeWidth={.45} vectorEffect="non-scaling-stroke"/>{box.children.map(child=><MiniBox key={child.node.key} box={child}/>)}</g>;});
export const DetailedMiniMapNode=memo(function DetailedMiniMapNode({id,x,y,onClick}:MiniMapNodeProps){const box=useContext(MiniMapBoxes).get(id);return box?<g transform={`translate(${x},${y})`} onClick={onClick?e=>onClick(e,id):undefined}><MiniBox box={box} root/></g>:null;});
