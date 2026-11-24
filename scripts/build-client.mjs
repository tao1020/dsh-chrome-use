import { readFile, writeFile } from 'node:fs/promises';
// Windows checkouts can use CRLF; normalize so the generated artifact stays
// byte-identical across platforms and the publish workflow sees no diff.
const readText = async (path) => (await readFile(path, 'utf8')).replace(/\r\n/g, '\n');
const contract = (await readText('src/settings-contract.js')).replace(/^export /gm, '');
const links = (await readText('src/links.js')).replace(/^export /gm, '');
const layout = (await readText('src/settings-layout.js')).replace(/^export /gm, '');
const mention = (await readText('src/mention.js')).replace(/^export /gm, '');
const releases = (await readText('src/release-check.js')).replace(/^export /gm, '');
const version = JSON.parse(await readText('package.json')).version;
const client = await readText('src/settings-client.js');
const output = `window.__ModuleLoader__.load({ id: 'dsh-chrome-use', factory: (require) => { const module = { exports: {} };\n${contract}\n${links}\n${layout}\n${mention}\n${releases}\nconst packageVersion = ${JSON.stringify(version)};\n${client}\nreturn module.exports; } });\n`;

if (process.argv.includes('--check')) {
  // The publish workflow rebuilds this file and fails on any diff, so lint the
  // committed artifact here instead of discovering it after a tag is cut.
  let current = '';
  try {
    current = await readText('src/client.js');
  } catch {}
  if (current !== output) {
    console.error('src/client.js is out of date; run `npm run build:client` and commit the result.');
    process.exitCode = 1;
  }
} else {
  await writeFile('src/client.js', output);
}
