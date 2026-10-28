import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
for (const directory of ['src', 'extension', 'scripts', 'test']) {
  for (const file of await readdir(directory)) {
    if (!/\.m?js$/.test(file)) continue;
    const result = spawnSync(process.execPath, ['--check', `${directory}/${file}`], { stdio: 'inherit' });
    assert.equal(result.status, 0, `${directory}/${file} syntax`);
  }
}
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const manifest = JSON.parse(await readFile('extension/manifest.json', 'utf8'));
assert.equal(manifest.version, pkg.version);
assert.equal(manifest.manifest_version, 3);
assert.deepEqual(manifest.permissions, ['debugger', 'tabs', 'tabGroups', 'storage', 'alarms']);
assert.equal(manifest.host_permissions, undefined);
assert.equal(manifest.content_scripts, undefined);
assert.ok(pkg.dsh.bundle.patch);
console.log('JavaScript syntax, package and extension manifest checks passed.');
