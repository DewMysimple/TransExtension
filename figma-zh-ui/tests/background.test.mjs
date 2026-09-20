import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const coreSource = fs.readFileSync(new URL('../src/core.js', import.meta.url), 'utf8');
const backgroundSource = fs.readFileSync(new URL('../src/background.js', import.meta.url), 'utf8');

function createBackground(initial = {}) {
  const stored = structuredClone(initial);
  let messageListener;
  const context = vm.createContext({
    chrome: {
      storage: {
        local: {
          async get(key) { return structuredClone({ [key]: stored[key] }); },
          async set(values) { Object.assign(stored, structuredClone(values)); }
        }
      },
      runtime: {
        onInstalled: { addListener() {} },
        onStartup: { addListener() {} },
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
      { text: 'Mystery Command', pageType: 'files/SyntheticPrivateTeam' },
      { text: 'https://example.test/private', pageType: 'settings' },
      { text: 'account@example.test', pageType: 'settings' },
      { text: 'content.js', pageType: 'settings' },
      { text: 'const value = 1', pageType: 'settings' },
      { text: '中文 Settings', pageType: 'settings' }
    ]
  });
  assert.equal(response.saved, 1);
  assert.equal(runtime.stored.auditEntries.length, 1);
  assert.equal(runtime.stored.auditEntries[0].pageType, 'unknown');
  assert.equal(JSON.stringify(runtime.stored).includes('SyntheticPrivateTeam'), false);
});

test('后台拒绝在扩展或审计关闭后到达的审计批次', async () => {
  for (const settings of [{ enabled: false }, { auditEnabled: false }]) {
    const runtime = createBackground({ settings });
    const response = await runtime.send({
      type: 'audit:recordBatch',
      entries: [{ text: 'Mystery Command', pageType: 'settings' }]
    });
    assert.equal(response.saved, 0);
    assert.equal(runtime.stored.auditEntries, undefined);
  }
});

test('并发批次与清空按消息顺序串行，保留准确计数', async () => {
  const runtime = createBackground();
  const message = {
    type: 'audit:recordBatch',
    entries: [{ text: 'Mystery Command', pageType: 'settings' }]
  };
  await Promise.all([runtime.send(message), runtime.send(message)]);
  assert.equal(runtime.stored.auditEntries[0].count, 2);
  await Promise.all([runtime.send(message), runtime.send({ type: 'audit:clear' })]);
  assert.deepEqual(runtime.stored.auditEntries, []);
});
