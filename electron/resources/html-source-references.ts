import MarkdownIt from 'markdown-it';
const syntax = new MarkdownIt();
const space = (char: string) => /[\t\n\f\r ]/.test(char);

/** Conservative source tokenizer: quoted attributes and inert text cannot create file authority. */
export function htmlSourceReferences(source: string): { images: string[]; links: string[] } {
  const images = new Set<string>(),
    links = new Set<string>();
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf('<', cursor);
    if (start < 0) break;
    cursor = start + 1;
    if (source.startsWith('!--', cursor)) {
      const end = source.indexOf('-->', cursor + 3);
      cursor = end < 0 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith('![CDATA[', cursor)) {
      const end = source.indexOf(']]>', cursor + 8);
      cursor = end < 0 ? source.length : end + 3;
      continue;
    }
    const closing = source[cursor] === '/';
    if (closing) cursor++;
    const nameStart = cursor;
    while (/[A-Za-z0-9:-]/.test(source[cursor] ?? '') && cursor < source.length) cursor++;
    const name = source.slice(nameStart, cursor).toLowerCase();
    const attributes = new Map<string, string>();
    let valid = Boolean(name) && /^[a-z]/.test(name),
      ended = false;
    if (valid && source[cursor] !== '>' && source[cursor] !== '/' && !space(source[cursor] ?? ''))
      valid = false;
    while (cursor < source.length) {
      while (space(source[cursor] ?? '') || source[cursor] === '/') cursor++;
      if (source[cursor] === '>') {
        cursor++;
        ended = true;
        break;
      }
      const attributeStart = cursor;
      while (cursor < source.length && !space(source[cursor]) && !/[=/>]/.test(source[cursor]))
        cursor++;
      const attribute = source.slice(attributeStart, cursor).toLowerCase();
      if (!attribute || /[<"'\0]/.test(attribute)) {
        valid = false;
        cursor = source.indexOf('>', cursor);
        if (cursor < 0) cursor = source.length;
        else cursor++;
        ended = true;
        break;
      }
      while (space(source[cursor] ?? '')) cursor++;
      let value = '';
      if (source[cursor] === '=') {
        cursor++;
        while (space(source[cursor] ?? '')) cursor++;
        if (source[cursor] === '"' || source[cursor] === "'") {
          const quote = source[cursor++],
            valueStart = cursor,
            end = source.indexOf(quote, cursor);
          if (end < 0) {
            cursor = source.length;
            valid = false;
            break;
          }
          value = source.slice(valueStart, end);
          cursor = end + 1;
        } else {
          const valueStart = cursor;
          while (cursor < source.length && !space(source[cursor]) && source[cursor] !== '>')
            cursor++;
          value = source.slice(valueStart, cursor);
          if (/[<"'=`\0]/.test(value)) valid = false;
        }
      }
      if (!attributes.has(attribute)) attributes.set(attribute, syntax.utils.unescapeAll(value));
    }
    if (!ended || !valid || closing) continue;
    if (
      [
        'script',
        'style',
        'textarea',
        'title',
        'xmp',
        'iframe',
        'noembed',
        'noframes',
        'noscript',
        'template',
        'plaintext',
      ].includes(name)
    ) {
      // shortcut: nested template/script-escape states need a full HTML tokenizer; reject that uncertain tail.
      if (name === 'template' || name === 'plaintext' || name === 'noscript') break;
      const close = new RegExp(`</${name}[\\t\\n\\f\\r />]`, 'ig');
      close.lastIndex = cursor;
      const match = close.exec(source);
      if (!match) break;
      if (name === 'script' && /<!--|<script[\t\n\f\r />]/i.test(source.slice(cursor, match.index)))
        break;
      const end = source.indexOf('>', match.index);
      cursor = end < 0 ? source.length : end + 1;
      continue;
    }
    const target = attributes.get(name === 'img' ? 'src' : name === 'a' ? 'href' : '') ?? '';
    if (!target || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(target)) continue;
    if (name === 'img') images.add(target);
    else if (name === 'a') links.add(target);
  }
  return { images: [...images], links: [...links] };
}
