import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyFailure, failureFromError, failureSummary, formatFailure } from '../extension/failures.js';

test('an error code becomes a retry instruction instead of only text', () => {
  const stale = classifyFailure('STALE_ELEMENT: take a fresh snapshot');
  assert.equal(stale.code, 'STALE_ELEMENT');
  assert.equal(stale.retry, 'snapshot');
  assert.equal(stale.actionSent, false);
  assert.match(stale.hint, /snapshot/i);

  const blocked = classifyFailure('TAB_BUSY: wait for the running command');
  assert.equal(blocked.retry, 'wait');

  const captcha = classifyFailure('CHALLENGE_DETECTED: the page shows a captcha');
  assert.equal(captcha.retry, 'user');
});

test('a timeout says whether input may already have been sent', () => {
  assert.equal(classifyFailure('CHROME_TIMEOUT: click', 'click').actionSent, true);
  assert.equal(classifyFailure('CHROME_TIMEOUT: snapshot', 'snapshot').actionSent, false);
  assert.equal(classifyFailure('BROWSER_TIMEOUT: the connection was closed', 'click').actionSent, null);
  assert.equal(classifyFailure('RESULT_TOO_LARGE: too big', 'snapshot').actionSent, true);
});

test('CDP page errors lose the Error: wrapper but keep the code', () => {
  const failure = classifyFailure('Error: ELEMENT_DISABLED');
  assert.equal(failure.code, 'ELEMENT_DISABLED');
  assert.equal(failure.retry, 'user');
  assert.doesNotMatch(failure.message, /^Error:/);
});

test('an unknown error still tells the model to inspect the page', () => {
  const failure = classifyFailure('something odd happened');
  assert.equal(failure.code, 'UNKNOWN_FAILURE');
  assert.equal(failure.retry, 'inspect');
});

test('formatting keeps the code first and appends one JSON line', () => {
  const formatted = formatFailure(classifyFailure('STALE_ELEMENT: take a fresh snapshot', 'click'));
  const [first, second] = formatted.split('\n');
  assert.match(first, /^STALE_ELEMENT/);
  assert.match(second, /^Failure: /);
  assert.deepEqual(JSON.parse(second.slice('Failure: '.length)), {
    code: 'STALE_ELEMENT',
    actionSent: false,
    retry: 'snapshot',
    hint: 'Take a fresh snapshot; references from before the page changed are invalid.',
  });
});

test('an attached failure survives a second classification without a duplicate block', () => {
  const original = new Error('ASSERT_FAILED: the condition was false after 0ms\nFailure: {"code":"ASSERT_FAILED","actionSent":false,"retry":"inspect"}');
  original.failure = { code: 'ASSERT_FAILED', actionSent: false, retry: 'inspect' };
  const failure = failureFromError(original, 'assert');
  assert.equal(failure.code, 'ASSERT_FAILED');
  assert.equal(failure.actionSent, false);
  assert.equal(failure.retry, 'inspect');
  assert.doesNotMatch(failure.message, /Failure:/);
  assert.equal(failureSummary(failure).code, 'ASSERT_FAILED');
});
