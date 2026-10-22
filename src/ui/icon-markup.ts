import paths from './icon-paths.json';

// Paths are vetted, local Fluent SVG assets; no user input becomes markup.
export function iconMarkup(name: keyof typeof paths, size = 16): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">${paths[name].regular.map((path) => `<path d="${path.d}"${'fillRule' in path && path.fillRule === 'evenodd' ? ' fill-rule="evenodd"' : ''}/>`).join('')}</svg>`;
}
