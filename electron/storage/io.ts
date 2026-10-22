import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';

export const hash = (value: string | Uint8Array): string =>
  createHash('sha256').update(value).digest('hex');
export const isMissing = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';

export async function readOptional(file: string): Promise<Buffer | null> {
  try {
    return await readFile(file);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

export async function atomicWrite(file: string, data: string | Uint8Array): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  let mode: number | undefined;
  try {
    mode = (await stat(file)).mode;
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  try {
    const handle = await open(temporary, 'wx', mode);
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  const bytes = await readOptional(file);
  if (!bytes) return fallback;
  try {
    return JSON.parse(bytes.toString('utf8')) as T;
  } catch {
    throw new Error(`配置文件无法读取，原文件已保留：${path.basename(file)}`);
  }
}

export const writeJson = (file: string, value: unknown): Promise<void> =>
  atomicWrite(file, JSON.stringify(value, null, 2));

export class OperationQueue {
  private pending: Promise<unknown> = Promise.resolve();
  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation);
    this.pending = result.catch(() => undefined);
    return result;
  }
  async flush(): Promise<void> {
    await this.pending;
  }
}
