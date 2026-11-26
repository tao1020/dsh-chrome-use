import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Git conflict markers are seven characters at the start of a line. `=======`
// has no branch name, so no trailing space; the other two are followed by one.
const CONFLICT_MARKER = /^(?:<{7} |={7}|>{7} )/;
const BUILD_DIRECTORIES = new Set(['node_modules', 'dist', 'lib']);

export function findConflictMarkers(text) {
  const markers = [];
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].replace(/\r$/, '');
    if (CONFLICT_MARKER.test(line)) markers.push({ line: index + 1, text: line });
  }
  return markers;
}

export async function findRepositoryConflictMarkers({ cwd = process.cwd() } = {}) {
  const listed = spawnSync('git', ['-C', cwd, 'ls-files', '-z'], { encoding: 'utf8' });
  if (listed.error) throw new Error(`无法运行 git ls-files：${listed.error.message}`);
  if (listed.status !== 0) throw new Error(`git ls-files 失败：${listed.stderr.trim()}`);
  const conflicts = [];
  for (const file of listed.stdout.split('\0').filter(Boolean)) {
    if (file.split('/').some((segment) => BUILD_DIRECTORIES.has(segment))) continue;
    const contents = await readFile(join(cwd, file)).catch((error) => {
      throw new Error(`无法读取 ${file}：${error.message}`);
    });
    if (contents.includes(0)) continue; // Binary file, not text.
    for (const marker of findConflictMarkers(contents.toString('utf8'))) {
      conflicts.push({ file, line: marker.line, text: marker.text });
    }
  }
  return conflicts;
}

export function describeConflict({ file, line, text }) {
  return `${file}:${line} 出现合并冲突标记（${text}），请解决冲突后再提交。`;
}
