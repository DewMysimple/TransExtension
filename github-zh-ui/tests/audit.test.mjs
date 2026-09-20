import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
const core = require('../src/core.js');
const firstSeen = '2026-01-01T00:00:00.000Z';
const lastSeen = '2026-03-01T00:00:00.000Z';
const legacy = {
  text: 'Mystery Command',
  pageType: 'repository/settings/environments/SyntheticPrivateEnvironment',
  count: 3,
  firstSeen,
  lastSeen
};

test('审计清洗只保留合法字段、合并规范化页面并保留时间和次数', () => {
  const original = [
    { ...legacy, privateUrl: 'https://example.test/private' },
    { ...legacy, pageType: 'repository/settings/environments/AnotherEnvironment', count: 2, firstSeen: '2025-12-01T00:00:00.000Z' },
    { ...legacy, text: 'Second Command', pageType: 'settings/profile', count: 1 },
    ...['https://example.test/private', 'account@example.test', 'content.js', 'const value = 1'].map((text) => ({ ...legacy, text }))
  ];
  const snapshot = structuredClone(original);
  const result = core.sanitizeAuditEntries(original);
  assert.equal(result.length, 2);
  assert.deepEqual(result.find((entry) => entry.text === legacy.text), {
    text: legacy.text, pageType: 'repository/settings/environments', count: 5,
    firstSeen: '2025-12-01T00:00:00.000Z', lastSeen
  });
  assert.equal(JSON.stringify(result).includes('Private'), false);
  assert.deepEqual(original, snapshot, 'pure sanitizer must not mutate stored input');
  assert.deepEqual(core.sanitizeAuditEntries(result), result, 'repeated reads and exports must be idempotent');
});

test('审计清洗能处理损坏存储，避免无效计数或日期破坏后台与导出', () => {
  assert.deepEqual(core.sanitizeAuditEntries(null), []);
  assert.deepEqual(core.sanitizeAuditEntries({}), []);
  assert.deepEqual(core.sanitizeAuditEntries([
    null, {}, { ...legacy, count: -1 }, { ...legacy, lastSeen: 'invalid' },
    { ...legacy, text: { private: 'data' } }
  ]), []);
});

test('实际 popup 从旧存储读取和导出均使用清洗结果，后台未启动也不泄漏动态路径', async (t) => {
  const popupHtml = await fs.readFile(new URL('../src/popup.html', import.meta.url), 'utf8');
  const dom = new JSDOM(popupHtml, { url: 'https://extension.example.test/src/popup.html', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const window = dom.window;
  const unsafeEntries = [legacy, { ...legacy, text: 'account@example.test' }, { ...legacy, text: 'const value = 1' }];
  let exportedBlob;
  const storedSnapshot = structuredClone(unsafeEntries);
  window.chrome = {
    runtime: { lastError: null },
    tabs: { async query() { return []; } },
    storage: { local: { async get() { return { auditEntries: unsafeEntries }; } } }
  };
  window.Blob = Blob;
  window.URL.createObjectURL = (blob) => { exportedBlob = blob; return 'blob:synthetic-audit'; };
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = () => {};
  // Follow the real local popup script order so a missing core include fails.
  for (const element of window.document.querySelectorAll('script[src]')) {
    const source = await fs.readFile(new URL(`../src/${element.getAttribute('src')}`, import.meta.url), 'utf8');
    window.eval(source);
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(window.document.getElementById('audit-total').textContent, '1');
  window.document.getElementById('export-audit').click();
  assert.ok(exportedBlob);
  const report = JSON.parse(await exportedBlob.text());
  assert.deepEqual(report.entries, [{ ...legacy, pageType: 'repository/settings/environments' }]);
  assert.equal(JSON.stringify(report).includes('SyntheticPrivateEnvironment'), false);
  assert.deepEqual(unsafeEntries, storedSnapshot, 'popup must not race background storage writes');
});
