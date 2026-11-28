#!/usr/bin/env node
// Uploads the packaged zip to the Chrome Web Store and submits it for review.
// Credentials come from the environment only: CWS_CLIENT_ID, CWS_CLIENT_SECRET,
// CWS_REFRESH_TOKEN and CWS_APP_ID. Nothing is printed except the store's own
// status, so a log never contains a secret.
import { readFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const zip = process.argv[2] ?? join(root, 'dist', `dsh-chrome-use-${version}.zip`);
const required = ['CWS_CLIENT_ID', 'CWS_CLIENT_SECRET', 'CWS_REFRESH_TOKEN', 'CWS_APP_ID'];
const missing = required.filter(name => !process.env[name]);
if (missing.length) {
  console.error(`publish-store: missing environment: ${missing.join(', ')}`);
  process.exit(2);
}
const { CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN, CWS_APP_ID } = process.env;

async function json(url, init) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(120000) });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${url} answered ${response.status}: ${text.slice(0, 300)}`);
  }
  if (!response.ok) throw new Error(`${url} answered ${response.status}: ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

const bytes = await readFile(zip);
console.log(`publish-store: uploading ${zip} (${bytes.length} bytes) for version ${version}`);

const token = await json('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ client_id: CWS_CLIENT_ID, client_secret: CWS_CLIENT_SECRET, refresh_token: CWS_REFRESH_TOKEN, grant_type: 'refresh_token' }),
});
const auth = { authorization: `Bearer ${token.access_token}`, 'x-goog-api-version': '2' };

const upload = await json(`https://www.googleapis.com/upload/chromewebstore/v1.1/items/${CWS_APP_ID}?uploadType=media`, {
  method: 'PUT',
  headers: { ...auth, 'content-type': 'application/zip' },
  body: bytes,
});
if (upload.uploadState !== 'SUCCESS') {
  throw new Error(`upload rejected: ${upload.uploadState} ${JSON.stringify(upload.itemError ?? [])}`);
}
console.log(`publish-store: upload ${upload.uploadState}`);

const publish = await json(`https://www.googleapis.com/chromewebstore/v1.1/items/${CWS_APP_ID}/publish?publishTarget=default`, { method: 'POST', headers: auth });
if (!['OK', 'ITEM_PENDING_REVIEW'].includes(publish.status?.[0] ?? publish.status)) {
  throw new Error(`publish rejected: ${JSON.stringify(publish)}`);
}
console.log(`publish-store: submitted for review (${JSON.stringify(publish.status)})`);
