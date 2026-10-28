/** An unresolved local asset must not become a successful export with a blank space. */
export function validateExportContent(root: HTMLElement): void {
  const unresolved = root.querySelector('.note-reference-error');
  if (unresolved) throw new Error(`引用未能完整读取，导出已停止：${unresolved.textContent}`);
  for (const image of root.querySelectorAll<HTMLImageElement>('img')) {
    if (!image.getAttribute('src'))
      throw new Error(
        `图片未能读取，导出已停止：${image.dataset.assetSrc || image.alt || '未命名图片'}`,
      );
  }
  for (const diagram of root.querySelectorAll<HTMLElement>('[data-mermaid="true"]')) {
    if (diagram.dataset.rendered !== 'true' || !diagram.querySelector('svg'))
      throw new Error(
        diagram.querySelector('.diagram-error')?.textContent ||
          '图表尚未成功排版，导出已停止。请检查 Mermaid 语法。',
      );
  }
}
