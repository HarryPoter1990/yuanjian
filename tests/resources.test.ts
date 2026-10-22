import { describe, expect, it } from 'vitest';
import { fontExtension, isFontData, safeArchiveFont } from '../electron/resources/fonts';

describe('字体资源输入边界', () => {
  it('只导入字体内容，扩展名伪装不能成为字体', () => {
    expect(fontExtension('示例.TTF')).toBe('.ttf');
    expect(fontExtension('脚本.exe')).toBeNull();
    expect(isFontData(new Uint8Array([0, 1, 0, 0, 0, 5, 0, 0]))).toBe(true);
    expect(isFontData(new TextEncoder().encode('<script>alert(1)</script>'))).toBe(false);
  });
  it('字体ZIP中的路径穿越和超大资源不能导入', () => {
    expect(safeArchiveFont('fonts/中文.ttf', 2000)).toBe(true);
    expect(safeArchiveFont('../outside.ttf', 2000)).toBe(false);
    expect(safeArchiveFont('C:\\outside.ttf', 2000)).toBe(false);
    expect(safeArchiveFont('font.ttf', 300 * 1024 * 1024)).toBe(false);
  });
});
