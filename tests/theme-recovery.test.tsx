// @vitest-environment jsdom
import {act,useState} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {SettingsPanel} from '../src/components/SettingsPanel';
import {defaultSettings,defaultAppearance} from '../src/shared/defaults';
import {appearanceColors} from '../src/ui/model';
import type {Settings} from '../src/shared/types';
let host:HTMLDivElement,root:Root,current:Settings;
beforeEach(()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 window.matchMedia=()=>({matches:false}) as MediaQueryList;
 HTMLDialogElement.prototype.showModal=function(){this.open=true;};HTMLDialogElement.prototype.close=function(){this.open=false;};
 window.notes={getFontCatalog:async()=>[],historyStats:async()=>({count:0,textBytes:0,imageBytes:0,totalBytes:0})} as unknown as typeof window.notes;
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
async function mount(settings:Settings){function Harness(){const[value,setValue]=useState(settings);current=value;return <SettingsPanel settings={value} fonts={[]} dataDirectory="generated" version="probe" onChange={setValue} onFonts={()=>{}} onClose={()=>{}} onError={error=>{throw Error(error);}} saveState="generated"/>;}await act(async()=>root.render(<Harness/>));}
const button=(text:string)=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent?.includes(text))!;
async function accent(value:string){const field=host.querySelector<HTMLInputElement>('[aria-label="强调色"]')!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(field,value);field.dispatchEvent(new Event('input',{bubbles:true}));});}
it('undo removes overrides added since opening settings',async()=>{
 await mount(structuredClone(defaultSettings));await accent('#bb3366');expect(appearanceColors(current.appearance,false).accent).toBe('#bb3366');
 await act(async()=>button('撤销本次外观修改').click());
 console.info('theme-undo',JSON.stringify({overrides:current.appearance.paletteOverrides,actual:appearanceColors(current.appearance,false).accent,expected:defaultAppearance.accent}));
 expect(current.appearance.paletteOverrides).toBeUndefined();
 expect(appearanceColors(current.appearance,false).accent).toBe(defaultAppearance.accent);
});
it('restore defaults clears custom mode overrides',async()=>{
 const settings=structuredClone(defaultSettings);settings.appearance.paletteOverrides={light:{accent:'#bb3366'}};await mount(settings);
 await act(async()=>button('恢复默认外观').click());
 console.info('theme-reset',JSON.stringify({actual:appearanceColors(current.appearance,false).accent,expected:defaultAppearance.accent}));
 expect(current.appearance.paletteOverrides).toBeUndefined();
});
it('applying a saved theme does not inherit the previous theme overrides',async()=>{
 const settings=structuredClone(defaultSettings);settings.appearance.paletteOverrides={light:{accent:'#bb3366'}};settings.themes=[{id:'generated-theme',name:'generated baseline theme',appearance:structuredClone(defaultAppearance)}];await mount(settings);
 await act(async()=>button('generated baseline theme').click());
 console.info('theme-apply',JSON.stringify({actual:appearanceColors(current.appearance,false).accent,expected:defaultAppearance.accent}));
 expect(appearanceColors(current.appearance,false).accent).toBe(defaultAppearance.accent);
});
