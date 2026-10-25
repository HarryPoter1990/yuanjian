import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
it('uses the Yuanjian identity while retaining the established installer upgrade identity', async () => {
  const metadata = JSON.parse(await readFile('package.json', 'utf8'));
  const { UUID } = createRequire(import.meta.url)('builder-util-runtime');
  const legacyGuid = UUID.v5(
    'local.qingjian.notes',
    UUID.parse('50e065bc-3134-11e6-9bab-38c9862bdaf3'),
  );
  expect(metadata.productName).toBe('鸢笺');
  expect(metadata.build.appId).toBe('local.yuanjian.notes');
  expect(metadata.build.nsis.guid).toBe(legacyGuid);
  expect(metadata.build.win.executableName).toBe('Yuanjian');
  expect(metadata.build.nsis.deleteAppDataOnUninstall).toBe(false);
});
