import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const html = await readFile(new URL('../test/fixtures/page.html', import.meta.url));
const server = createServer((req, res) => {
  if (req.headers.host !== '127.0.0.1:18792') { res.writeHead(403); res.end(); return; }
  res.setHeader('Cache-Control', 'no-store');
  if (req.url.startsWith('/expected-error')) { res.writeHead(503); res.end('intentional test error'); return; }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(req.url === '/second' ? '<!doctype html><title>Second test page</title><h1>第二页</h1><a href="/">返回测试页</a>' : html);
});
server.listen(18792, '127.0.0.1', () => console.log('Fixture: http://127.0.0.1:18792/'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
