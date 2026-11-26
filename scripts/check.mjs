import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { describeConflict, findRepositoryConflictMarkers } from './conflict-markers.mjs';

const conflicts = await findRepositoryConflictMarkers();
for (const conflict of conflicts) console.error(describeConflict(conflict));
assert.equal(conflicts.length, 0, `发现 ${conflicts.length} 处合并冲突标记`);
for (const directory of ['src', 'extension', 'scripts', 'test']) {
  for (const file of await readdir(directory)) {
    if (!/\.m?js$/.test(file)) continue;
    const result = spawnSync(process.execPath, ['--check', `${directory}/${file}`], { stdio: 'inherit' });
    assert.equal(result.status, 0, `${directory}/${file} syntax`);
  }
}
const buildCheck = spawnSync(process.execPath, ['scripts/build-client.mjs', '--check'], { stdio: 'inherit' });
assert.equal(buildCheck.status, 0, 'src/client.js is in sync with its sources and package version');
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const manifest = JSON.parse(await readFile('extension/manifest.json', 'utf8'));
assert.equal(manifest.version, pkg.version);
assert.equal(manifest.manifest_version, 3);
assert.deepEqual(manifest.permissions, ['debugger', 'tabs', 'tabGroups', 'storage', 'alarms', 'downloads', 'webNavigation', 'contextMenus', 'offscreen', 'clipboardWrite']);
assert.equal(manifest.host_permissions, undefined);
assert.equal(manifest.content_scripts, undefined);
assert.equal(manifest.content_security_policy.extension_pages, "script-src 'self'; object-src 'none'; connect-src ws://127.0.0.1:*");
assert.ok(pkg.dsh.bundle.patch);
console.log('Conflict markers, JavaScript syntax, generated client, package and extension manifest checks passed.');
