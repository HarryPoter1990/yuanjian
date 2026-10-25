import { expect, it } from 'vitest';
import { argumentSchemas, sessionSchema } from '../electron/validation';
import { makeDraft } from '../src/ui/model';

it('bounds import sources and file batches without accepting arbitrary argument shapes', () => {
  expect(argumentSchemas.prepareFiles.parse([['D:/generated/note.md']])).toEqual([
    ['D:/generated/note.md'],
  ]);
  for (const value of [
    [],
    [[]],
    [Array.from({ length: 101 }, () => 'D:/x.md')],
    [['']],
    [{ path: 'D:/x.md' }],
  ])
    expect(argumentSchemas.prepareFiles.safeParse(value).success).toBe(false);
  expect(argumentSchemas.chooseImports.parse([])).toEqual([]);
  expect(argumentSchemas.chooseImports.safeParse(['D:/arbitrary']).success).toBe(false);
  for (const encoding of ['utf-8', 'gb18030', 'utf-16le', 'utf-16be'])
    expect(argumentSchemas.readImport.parse(['source-id', encoding])).toEqual([
      'source-id',
      encoding,
    ]);
  expect(argumentSchemas.readImport.safeParse(['source-id', 'arbitrary-encoding']).success).toBe(
    false,
  );
  expect(argumentSchemas.importAssetUrl.safeParse(['', 'image.png']).success).toBe(false);
  expect(
    argumentSchemas.importAssetUrl.safeParse(['source-id', 'image.png', 'extra']).success,
  ).toBe(false);
});
it('keeps optional import origins through draft persistence and saving while accepting old drafts', () => {
  const old = makeDraft('正文');
  expect(sessionSchema.parse({ tabs: [old], activeId: old.id }).tabs[0]).not.toHaveProperty(
    'importSourceId',
  );
  const imported = { ...old, importSourceId: 'approved-source' };
  expect(
    sessionSchema.parse({ tabs: [imported], activeId: imported.id }).tabs[0].importSourceId,
  ).toBe('approved-source');
  expect(
    argumentSchemas.saveFile.parse([
      {
        path: null,
        content: '正文',
        baseContent: '',
        hash: '',
        title: '导入',
        importSourceId: 'approved-source',
      },
    ])[0].importSourceId,
  ).toBe('approved-source');
  expect(
    sessionSchema.safeParse({ tabs: [{ ...old, importSourceId: '' }], activeId: old.id }).success,
  ).toBe(false);
});
