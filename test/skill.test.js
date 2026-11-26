import test from 'node:test';
import assert from 'node:assert/strict';
import { chromeUseSkill, registerChromeUseSkill } from '../src/skill.js';

test('bundled skill is valid and covers the actual tool workflow', () => {
  assert.match(chromeUseSkill.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.ok(chromeUseSkill.description.length > 20);
  assert.ok(chromeUseSkill.description.length <= 500);
  for (const tool of ['chrome_status', 'chrome_pair', 'chrome_open', 'chrome_claim', 'chrome_snapshot', 'chrome_keep_awake', 'chrome_release']) {
    assert.match(chromeUseSkill.content, new RegExp(tool));
  }
  assert.match(chromeUseSkill.content, /不可信数据/);
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
