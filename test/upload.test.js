import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateUploadPaths } from '../src/index.js';

test('upload paths must be existing files under home or temp, never hidden or relative', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-upload-'));
  try {
    const file = join(dir, 'report.txt');
    await writeFile(file, 'ok');
    assert.deepEqual(await validateUploadPaths([file]), [await realpath(file)]);
    await assert.rejects(validateUploadPaths(['relative.txt']), /NOT_ABSOLUTE/);
    await assert.rejects(validateUploadPaths([join(dir, '.hidden')]), /HIDDEN/);
    await assert.rejects(validateUploadPaths([join(dir, 'missing.txt')]), /NOT_FOUND/);
    await assert.rejects(validateUploadPaths([dir]), /NOT_A_FILE/);
    const outside = process.platform === 'win32' ? 'C:\\Windows\\win.ini' : '/etc/passwd';
    await assert.rejects(validateUploadPaths([outside]), /OUTSIDE_HOME_OR_TEMP/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
