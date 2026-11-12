import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const html = await readFile(new URL('../test/fixtures/page.html', import.meta.url));
const iframe = '<!doctype html><title>iframe</title><button id="inside">iframe 内按钮</button><p id="iframe-result">iframe：未点击</p><script>document.querySelector("#inside").onclick = () => { document.querySelector("#iframe-result").textContent = "iframe：已点击"; };</script>';
const iframePage = '<!doctype html><title>iframe 测试页</title><h1>同源 iframe</h1><iframe src="/iframe" title="测试 iframe"></iframe><p><a href="/">返回测试页</a></p>';
// Password managers inject their own chrome-extension:// frames into forms with a
// password field, and Chrome then refuses to attach the debugger to that tab.
const formsPage = '<!doctype html><title>表单测试页（含密码框）</title><h1>表单测试页</h1><label for="user">用户名</label><input id="user" autocomplete="off"><label for="pw">密码</label><input id="pw" type="password" value="fixture-only"><p id="form-note">含密码框的页面可能被 Chrome 拒绝调试，用于验证错误提示。</p><p><a href="/">返回测试页</a></p>';
const server = createServer((req, res) => {
  if (req.headers.host !== '127.0.0.1:18792') { res.writeHead(403); res.end(); return; }
  res.setHeader('Cache-Control', 'no-store');
  const url = new URL(req.url, 'http://127.0.0.1:18792');
  if (url.pathname === '/expected-error') { res.writeHead(503); res.end('intentional test error'); return; }
  if (url.pathname === '/json') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true, source: 'fixture' })); return; }
  if (url.pathname === '/slow') {
    const ms = Math.min(Math.max(Number(url.searchParams.get('ms')) || 500, 0), 5000);
    setTimeout(() => { res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.end(`slow response after ${ms}ms`); }, ms);
    return;
  }
  if (url.pathname === '/download') {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="dsh-fixture.txt"');
    res.end('fixture download file\n');
    return;
  }
  if (url.pathname === '/iframe') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(iframe); return; }
  if (url.pathname === '/frame') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(iframePage); return; }
  if (url.pathname === '/forms') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(formsPage); return; }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(url.pathname === '/second' ? '<!doctype html><title>Second test page</title><h1>第二页</h1><a href="/">返回测试页</a>' : html);
});
server.listen(18792, '127.0.0.1', () => console.log('Fixture: http://127.0.0.1:18792/'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
