export function exportCanvasStyle(background: string, foreground: string): string {
  // The injected desktop :root paints beyond body content, so reset the root canvas too.
  return `html:root,body{height:auto;overflow:visible;background:${background};color:${foreground}}`;
}
