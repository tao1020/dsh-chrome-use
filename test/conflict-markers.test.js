import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findConflictMarkers, findRepositoryConflictMarkers } from '../scripts/conflict-markers.mjs';

test('reports every conflict marker line with its line number', () => {
  const text = [
    '# 更新日志',
    '',
    '<<<<<<< HEAD',
    'ours',
    '=======',
    'theirs',
    '>>>>>>> feature/branch',
    '',
  ].join('\n');
  assert.deepEqual(findConflictMarkers(text), [
    { line: 3, text: '<<<<<<< HEAD' },
    { line: 5, text: '=======' },
    { line: 7, text: '>>>>>>> feature/branch' },
  ]);
});

test('ignores text that has no conflict marker lines', () => {
  const text = [
    '# 标题',
    '=====',
    '  <<<<<<< HEAD',
    'a <<<<<<< HEAD in the middle of a line',
    '<<<<<< HEAD',
    '======',
    '>>>>>>>feature',
    '>>>>>> feature',
    '',
  ].join('\n');
  assert.deepEqual(findConflictMarkers(text), []);
});

test('recognizes markers separated by CRLF line endings', () => {
  assert.deepEqual(findConflictMarkers('ok\r\n<<<<<<< HEAD\r\n=======\r\n'), [
    { line: 2, text: '<<<<<<< HEAD' },
    { line: 3, text: '=======' },
  ]);
});

test('scans tracked text files and skips build directories and binary files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'conflict-markers-'));
  try {
    await mkdir(join(root, 'src'), { recursive: true });
    await mkdir(join(root, 'dist'), { recursive: true });
    await writeFile(join(root, 'src', 'clean.js'), 'export const ok = true;\n');
    await writeFile(join(root, 'src', 'conflicted.js'), 'const a = 1;\n<<<<<<< HEAD\n');
    await writeFile(join(root, 'dist', 'bundle.js'), '=======\n');
    await writeFile(join(root, 'src', 'icon.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]));
    const git = (...args) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
    assert.equal(git('init', '--quiet').status, 0, git('init', '--quiet').stderr);
    assert.equal(git('add', '.').status, 0, git('add', '.').stderr);
    assert.deepEqual(await findRepositoryConflictMarkers({ cwd: root }), [
      { file: 'src/conflicted.js', line: 2, text: '<<<<<<< HEAD' },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
