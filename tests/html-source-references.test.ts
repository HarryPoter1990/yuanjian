import { expect, it } from 'vitest';
import { htmlSourceReferences } from '../electron/resources/html-source-references';
it('skips ordinary raw-text and comments but retains real later images and links', () => {
  const html =
    '<script>const x=\'<img src="fake.png">\';</script><style>p:after{content:"<img src=other.png>"}</style><!-- <img src=comment.png> --><img src="real one.png"><a href="next.md#h">next</a>';
  expect(htmlSourceReferences(html)).toEqual({ images: ['real one.png'], links: ['next.md#h'] });
});
it('keeps complete quoted attributes opaque, distinguishes names, and follows the first duplicate attribute', () => {
  expect(
    htmlSourceReferences(
      '<div title=\'<img src="fake.png">\'>text</div><img data-src="fake.png" src="first.png" src="second.png"><imgfoo src="fake.png">',
    ),
  ).toEqual({ images: ['first.png'], links: [] });
});
it('declines uncertain script escape and template tails without granting their nested image text', () => {
  expect(
    htmlSourceReferences('<script><!-- <script> x</script><img src="fake.png"></script>'),
  ).toEqual({ images: [], links: [] });
  expect(htmlSourceReferences('<template><img src="fake.png"></template>')).toEqual({
    images: [],
    links: [],
  });
});
