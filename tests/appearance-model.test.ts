import{expect,it}from'vitest';
import{defaultAppearance,defaultSettings}from'../src/shared/defaults';
import{appearanceColors}from'../src/ui/model';
import{applyColorTheme,applyAppearanceScheme,colorThemeSnapshot,contrastRatio}from'../src/shared/appearance';
import{settingsSchema}from'../electron/validation';
it('selects independent light/dark palettes without contaminating legacy colors or changing fonts',()=>{
 const base={...defaultAppearance,mode:'system' as const,paletteByMode:{light:'paper' as const,dark:'ink' as const},bodyFont:'chosen',wallpaper:'D:/chosen.png'};
 expect(appearanceColors(base,false).background).toBe('#FAF8F3');expect(appearanceColors(base,true).background).toBe('#191919');
 const themed=applyColorTheme(base,{id:'one',name:'one',appearance:colorThemeSnapshot({...defaultAppearance,paletteOverrides:undefined})});
 expect(themed.bodyFont).toBe('chosen');expect(themed.wallpaper).toBe('D:/chosen.png');expect(themed.paletteByMode).toBeUndefined();
});
it('restores a legacy full scheme and removes optional values, while a selective scheme preserves excluded parts',()=>{
 const base={...defaultAppearance,wallpaper:'D:/keep.png',paletteOverrides:{light:{accent:'#bb3366'}}};
 const scheme={id:'legacy',name:'legacy',appearance:structuredClone(defaultAppearance)};
 expect(applyAppearanceScheme(base,scheme).paletteOverrides).toBeUndefined();
 const selective=applyAppearanceScheme(base,{...scheme,includes:{colors:true,fonts:false,wallpaper:false}});
 expect(selective.wallpaper).toBe('D:/keep.png');expect(selective.paletteOverrides).toBeUndefined();
});
it('preserves advanced semantic colors through IPC and picks readable button foreground without changing the accent',()=>{
 const appearance={...defaultAppearance,mode:'dark' as const,paletteOverrides:{dark:{accent:'#eeeeee',sidebar:'#222222',border:'#667766'}}};
 const value=settingsSchema.parse({...defaultSettings,appearance});expect(value.appearance.paletteOverrides?.dark?.sidebar).toBe('#222222');
 const colors=appearanceColors(appearance,true);expect(colors.accent).toBe('#eeeeee');expect(contrastRatio(colors.accent,colors.accentText)).toBeGreaterThan(4.5);
});
