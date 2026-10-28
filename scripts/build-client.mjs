import { readFile, writeFile } from 'node:fs/promises';
const contract = (await readFile('src/settings-contract.js', 'utf8')).replace(/^export /gm, '');
const releases = (await readFile('src/release-check.js', 'utf8')).replace(/^export /gm, '');
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const client = await readFile('src/settings-client.js', 'utf8');
await writeFile('src/client.js', `window.__ModuleLoader__.load({ id: 'dsh-chrome-use', factory: (require) => { const module = { exports: {} };\n${contract}\n${releases}\nconst packageVersion = ${JSON.stringify(version)};\n${client}\nreturn module.exports; } });\n`);
