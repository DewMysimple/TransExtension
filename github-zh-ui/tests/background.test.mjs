import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const coreSource = fs.readFileSync(new URL('../src/core.js', import.meta.url), 'utf8');
const backgroundSource = fs.readFileSync(new URL('../src/background.js', import.meta.url), 'utf8');

function createBackground(initial = {}) {
  const stored = structuredClone(initial);
  let messageListener;
  const lifecycle = {};
  const context = vm.createContext({
    chrome: {
      storage: {
        local: {
          async get(key) { return structuredClone({ [key]: stored[key] }); },
          async set(values) { Object.assign(stored, structuredClone(values)); }
        }
      },
      runtime: {
        onInstalled: { addListener(listener) { lifecycle.installed = listener; } },
        onStartup: { addListener(listener) { lifecycle.startup = listener; } },
        onMessage: { addListener(listener) { messageListener = listener; } }
      }
    },
    importScripts(name) {
      assert.equal(name, 'core.js');
      vm.runInContext(coreSource, context);
    }
  });
  vm.runInContext(backgroundSource, context);
  return {
    stored,
    lifecycle,
    send(message) {
      return new Promise((resolve) => {
        assert.equal(messageListener(message, {}, resolve), true);
      });
    }
  };
}

test('后台复用候选过滤并剔除页面类别中的动态路径', async () => {
  const runtime = createBackground();
  const response = await runtime.send({
    type: 'audit:recordBatch',
    entries: [
      { text: 'Mystery Command', pageType: 'repository/settings/environments/SyntheticPrivateEnvironment' },
      { text: 'https://example.test/private', pageType: 'settings' },
      { text: 'account@example.test', pageType: 'settings' },
      { text: 'content.js', pageType: 'settings' },
      { text: 'const value = 1', pageType: 'settings' },
      { text: '中文 Settings', pageType: 'settings' }
    ]
  });
  assert.equal(response.saved, 1);
  assert.equal(runtime.stored.auditEntries.length, 1);
  assert.equal(runtime.stored.auditEntries[0].pageType, 'repository/settings/environments');
  assert.equal(JSON.stringify(runtime.stored).includes('SyntheticPrivateEnvironment'), false);
});

test('后台拒绝在扩展或审计关闭后到达的审计批次', async () => {
  for (const settings of [{ enabled: false }, { auditEnabled: false }]) {
    const runtime = createBackground({ settings });
    const response = await runtime.send({
      type: 'audit:recordBatch',
      entries: [{ text: 'Mystery Command', pageType: 'settings/profile' }]
    });
    assert.equal(response.saved, 0);
    assert.equal(runtime.stored.auditEntries, undefined);
  }
});

test('并发批次与清空按消息顺序串行，保留准确计数', async () => {
  const runtime = createBackground();
  const message = {
    type: 'audit:recordBatch',
    entries: [{ text: 'Mystery Command', pageType: 'settings/profile' }]
  };
  await Promise.all([runtime.send(message), runtime.send(message)]);
  assert.equal(runtime.stored.auditEntries[0].count, 2);
  await Promise.all([runtime.send(message), runtime.send({ type: 'audit:clear' })]);
  assert.deepEqual(runtime.stored.auditEntries, []);
});

const legacyEntry = {
  text: 'Mystery Command',
  pageType: 'repository/settings/environments/SyntheticPrivateEnvironment',
  count: 4,
  firstSeen: '2026-01-01T00:00:00.000Z',
  lastSeen: '2026-02-01T00:00:00.000Z'
};

test('安装与启动清洗旧审计，保留合法计数时间且合并同类条目', async () => {
  for (const event of ['installed', 'startup']) {
    const runtime = createBackground({ auditEntries: [
      legacyEntry,
      { ...legacyEntry, pageType: 'repository/settings/environments/AnotherPrivateEnvironment', count: 2 },
      { ...legacyEntry, text: 'https://example.test/private' },
      { ...legacyEntry, text: 'account@example.test' }
    ] });
    await runtime.lifecycle[event]();
    assert.deepEqual(runtime.stored.auditEntries, [{
      ...legacyEntry, pageType: 'repository/settings/environments', count: 6
    }]);
    assert.equal(runtime.stored.settings.enabled, true);
  }
});

test('读合并旧审计也清洗，避免在没有生命周期事件时保留动态路径', async () => {
  const runtime = createBackground({ auditEntries: [legacyEntry, { ...legacyEntry, text: 'const value = 1' }] });
  await runtime.send({ type: 'audit:recordBatch', entries: [{ text: legacyEntry.text, pageType: legacyEntry.pageType }] });
  assert.equal(runtime.stored.auditEntries.length, 1);
  const entry = runtime.stored.auditEntries[0];
  assert.equal(entry.pageType, 'repository/settings/environments');
  assert.equal(entry.count, 5);
  assert.equal(entry.firstSeen, legacyEntry.firstSeen);
  assert.ok(Date.parse(entry.lastSeen) >= Date.parse(legacyEntry.lastSeen));
});

test('旧审计迁移与清空串行，不会重新写回用户已清空的报告', async () => {
  const runtime = createBackground({ auditEntries: [legacyEntry] });
  await Promise.all([runtime.lifecycle.installed(), runtime.send({ type: 'audit:clear' })]);
  assert.deepEqual(runtime.stored.auditEntries, []);
});
