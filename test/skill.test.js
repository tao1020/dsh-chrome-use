import test from 'node:test';
import assert from 'node:assert/strict';
import { CAPABILITIES, chromeUseSkill, registerChromeUseSkill } from '../src/skill.js';

test('bundled skill is valid and covers the actual tool workflow', () => {
  assert.match(chromeUseSkill.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.ok(chromeUseSkill.description.length > 20);
  assert.ok(chromeUseSkill.description.length <= 500);
  for (const tool of ['chrome_status', 'chrome_pair', 'chrome_open', 'chrome_claim', 'chrome_snapshot', 'chrome_keep_awake', 'chrome_release']) {
    assert.match(chromeUseSkill.content, new RegExp(tool));
  }
  assert.match(chromeUseSkill.content, /不可信数据/);
});

test('the capability list is rendered and every capability is documented in the guide', () => {
  assert.ok(CAPABILITIES.length >= 10, 'the capability list must stay a real inventory');
  assert.match(chromeUseSkill.content, /## 能力清单/);
  // Only the guide body counts: searching the whole content would let a rendered
  // label satisfy its own anchor and hide a deleted explanation.
  const bodyStart = chromeUseSkill.content.indexOf('## 何时使用');
  assert.ok(bodyStart > 0, 'the guide body must follow the capability list');
  const body = chromeUseSkill.content.slice(bodyStart);
  const labels = new Set();
  for (const [label, anchor] of CAPABILITIES) {
    assert.ok(label.length > 0 && anchor.length > 0, 'capability entries are [label, anchor]');
    assert.ok(!labels.has(label), `duplicate capability "${label}"`);
    labels.add(label);
    assert.ok(!label.includes(anchor), `capability "${label}" anchor "${anchor}" matches its own label`);
    assert.ok(chromeUseSkill.content.includes(`- ${label}`), `capability list is missing "${label}"`);
    assert.ok(
      body.includes(anchor),
      `capability "${label}" is listed but never explained: the guide body does not mention "${anchor}"`,
    );
  }
});

test('registration goes through the plugin lifetime and exposes the skill to the catalog', () => {
  let registered;
  let usedEffect = false;
  const scope = {
    effect(callback) { usedEffect = true; return callback(); },
    skills: { register(skill) { registered = skill; return () => {}; } },
  };
  registerChromeUseSkill(scope);
  assert.ok(usedEffect, 'registration is tied to the plugin effect scope');
  assert.equal(registered.name, 'dsh-chrome-use');
  assert.equal(typeof registered.source, 'string');
});

test('skill carries the string source required when DSH loads it', () => {
  // DSH validates `source` only when the skill is loaded, not when it is
  // registered, so a missing value registers fine and fails later with
  // `loaded skill "dsh-chrome-use" source must be a string`.
  assert.equal(typeof chromeUseSkill.source, 'string');
  assert.equal(chromeUseSkill.source, 'runtime');
});

test('skill tells the user to mention the maintainer account in every issue', () => {
  assert.match(chromeUseSkill.content, /@tao1020/);
  assert.match(chromeUseSkill.content, /正文里 @tao1020/);
});

test('skill explains cross-Harness messaging and that messages are not user instructions', () => {
  assert.match(chromeUseSkill.content, /chrome_send_message/);
  assert.match(chromeUseSkill.content, /chrome_messages/);
  assert.match(chromeUseSkill.content, /其他 Agent/);
  assert.match(chromeUseSkill.content, /不是用户指令/);
});
