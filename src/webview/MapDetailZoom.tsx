import React,{createContext,useLayoutEffect,useRef,useState} from 'react';
import {useStoreApi} from '@xyflow/react';
export const MapDetailZoom=createContext({zoom:1,tick:0});
export function SampledMapZoom({initial,children}:{initial:number;children:React.ReactNode}){const store=useStoreApi(),[detail,setDetail]=useState({zoom:initial,tick:0}),committed=useRef(initial);
 useLayoutEffect(()=>{let timer:ReturnType<typeof setTimeout>|undefined,quiet:ReturnType<typeof setTimeout>|undefined,last=performance.now(),busy=false,disposed=false;
  const activity=(value:boolean)=>{if(busy===value)return;busy=value;document.documentElement.dataset.mapDetailBusy=String(value);window.dispatchEvent(new CustomEvent('latex-pro:map-detail-busy',{detail:value}));};
  const commit=()=>{clearTimeout(timer);timer=undefined;if(disposed)return;last=performance.now();const zoom=store.getState().transform[2];if(zoom!==committed.current){committed.current=zoom;setDetail(d=>({zoom,tick:d.tick+1}));}};
  const finish=()=>{clearTimeout(quiet);quiet=undefined;commit();activity(false);};
  const unsubscribe=store.subscribe((state,previous)=>{if(state.transform[2]===previous.transform[2])return;activity(true);if(!timer)timer=setTimeout(commit,Math.max(0,120-(performance.now()-last)));clearTimeout(quiet);quiet=setTimeout(finish,160);});
  const measured=()=>{last=performance.now();if(timer){clearTimeout(timer);timer=setTimeout(commit,120);}};commit();window.addEventListener('latex-pro:map-detail-tick',measured);window.addEventListener('latex-pro:map-detail-flush',finish);return ()=>{disposed=true;unsubscribe();clearTimeout(timer);clearTimeout(quiet);window.removeEventListener('latex-pro:map-detail-flush',finish);window.removeEventListener('latex-pro:map-detail-tick',measured);activity(false);};
 },[store]);return <MapDetailZoom.Provider value={detail}>{children}</MapDetailZoom.Provider>;
}
