import { readFile, writeFile } from 'node:fs/promises';
const contract = (await readFile('src/settings-contract.js', 'utf8')).replace(/^export /gm, '');
const client = await readFile('src/settings-client.js', 'utf8');
await writeFile('src/client.js', `window.__ModuleLoader__.load({ id: 'dsh-chrome-use', factory: (require) => { const module = { exports: {} };\n${contract}\n${client}\nreturn module.exports; } });\n`);
