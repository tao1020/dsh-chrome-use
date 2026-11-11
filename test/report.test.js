import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIssueReport, scrubText } from '../src/report.js';
import { validateArgs } from '../extension/protocol.js';

test('issue report keeps diagnostics and strips URL query strings', () => {
  const report = buildIssueReport({
    error: 'WAIT_TIMEOUT: 5000ms urls=https://example.com/a?token=secret#x',
    tool: 'chrome_wait',
    note: '点击导出后等待页面',
    pluginVersion: '0.6.6',
    extensionVersion: '0.6.5',
    connected: true,
    platform: 'darwin',
    nodeVersion: '22.0.0',
    now: new Date('2026-11-11T00:00:00Z'),
  });
  const url = new URL(report.url);
  assert.equal(url.host, 'github.com');
  assert.equal(url.pathname, '/tao1020/dsh-chrome-use/issues/new');
  assert.equal(url.searchParams.get('labels'), 'bug');
  assert.match(url.searchParams.get('title'), /chrome_wait 失败/);
  const body = url.searchParams.get('body');
  assert.ok(!body.includes('token=secret'));
  assert.ok(!body.includes('#x'));
  assert.match(body, /0\.6\.6/);
  assert.match(body, /0\.6\.5/);
  assert.match(body, /darwin/);
  assert.match(body, /22\.0\.0/);
  assert.equal(body, report.body);
});

test('issue report refuses an empty error and bounds the body', () => {
  assert.throws(() => buildIssueReport({ error: '   ' }), /REPORT_ERROR/);
  const report = buildIssueReport({ error: 'x'.repeat(5000), pluginVersion: '0.6.6' });
  assert.ok(new URL(report.url).searchParams.get('body').length <= 6000);
});

test('scrubText drops control characters and keeps plain links', () => {
  assert.equal(scrubText('a\u0007b\nc'), 'ab\nc');
  assert.equal(scrubText('见 https://example.com/diag?file=/etc/passwd'), '见 https://example.com/diag');
});

test('chrome_report validates its arguments', () => {
  assert.doesNotThrow(() => validateArgs('chrome_report', { error: 'boom' }));
  assert.doesNotThrow(() => validateArgs('chrome_report', { error: 'boom', tool: 'chrome_upload', note: '上传 diag 文件' }));
  assert.throws(() => validateArgs('chrome_report', {}), /MISSING_ARGUMENT/);
  assert.throws(() => validateArgs('chrome_report', { error: '' }), /INVALID_ARGUMENT/);
  assert.throws(() => validateArgs('chrome_report', { error: 'x'.repeat(2001) }), /too long/);
  assert.throws(() => validateArgs('chrome_report', { error: 'boom', page: 'secret' }), /INVALID_ARGUMENT/);
});
