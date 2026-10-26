import type {Appearance,ColorTheme,ThemePreset} from './types';
export const appearanceGroups = {
 colors:['palette','paletteByMode','paletteOverrides','accent','background','foreground','colorThemeId','density','codeTheme'],
 fonts:['uiFont','bodyFont','headingFont','codeFont','fontSize','lineHeight','contentWidth','codeFontSize','codeLineHeight'],
 wallpaper:['wallpaper','wallpaperOpacity','wallpaperBlur','wallpaperBrightness','wallpaperFit','wallpaperPosition','editorOpacity','sidebarOpacity'],
} as const;
export const allAppearanceParts = {colors:true,fonts:true,wallpaper:true};
function copyFields(target:Appearance, source:Partial<Appearance>,keys:readonly (keyof Appearance)[]):Appearance {
 const output={...target};
 for(const key of keys){if(Object.hasOwn(source,key)&&source[key]!==undefined)Object.assign(output,{[key]:structuredClone(source[key])});else delete output[key];}
 return output;
}
export function applyColorTheme(base:Appearance,theme:ColorTheme):Appearance {
 return {...copyFields(base,theme.appearance,appearanceGroups.colors),colorThemeId:theme.id};
}
export function colorThemeSnapshot(appearance:Appearance):ColorTheme['appearance'] {
 const {palette,paletteByMode,paletteOverrides,accent,background,foreground,density,codeTheme}=structuredClone(appearance);
 return {palette,paletteByMode,paletteOverrides,accent,background,foreground,density,codeTheme};
}
export function applyAppearanceScheme(base:Appearance,scheme:ThemePreset):Appearance {
 if(!scheme.includes)return structuredClone(scheme.appearance);
 let result=structuredClone(base);
 for(const group of ['colors','fonts','wallpaper'] as const)if(scheme.includes[group])result=copyFields(result,scheme.appearance,appearanceGroups[group]);
 return result;
}
export function contrastRatio(first:string,second:string):number|null {
 const luminance=(value:string)=>{
  const hex=value.replace(/^#/,'');const full=hex.length===3?[...hex].map(c=>c+c).join(''):hex;
  if(!/^[\da-f]{6}$/i.test(full))return null;
  const linear=[0,2,4].map(at=>{const n=parseInt(full.slice(at,at+2),16)/255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;});
  return linear[0]*.2126+linear[1]*.7152+linear[2]*.0722;
 };
 const a=luminance(first),b=luminance(second);return a===null||b===null?null:(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
}
export function accentForeground(accent:string):string {
 return (contrastRatio(accent,'#ffffff')??0)>(contrastRatio(accent,'#191919')??0)?'#FFFFFF':'#191919';
}
export const codeThemes=[{id:'classic',name:'经典'},{id:'calm',name:'柔和自然'},{id:'contrast',name:'清晰对比'}] as const;
export function syntaxColors(theme:Appearance['codeTheme'],dark:boolean):Record<string,string>{
 const palettes={classic:{light:['#85439b','#39714e','#9a5a27','#717a82','#956326','#346aa2'],dark:['#d4a0e8','#9bc9a0','#e4b282','#949da6','#dfc18d','#9dbfec']},calm:{light:['#89533c','#3c6b50','#99622d','#66726c','#786d36','#386d79'],dark:['#dfb295','#a5c6ab','#e2bd8a','#a3b0a7','#d1c08f','#a0c8cd']},contrast:{light:['#79349b','#236140','#8b460d','#596674','#805700','#235baa'],dark:['#e1aaf3','#a1e0af','#ffd296','#b4c0cd','#ead68c','#a6cfff']}};
 return Object.fromEntries(['keyword','string','number','comment','type','function'].map((key,index)=>[`--syntax-${key}`,palettes[theme??'classic'][dark?'dark':'light'][index]]));
}
