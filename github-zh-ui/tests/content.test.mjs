import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(testDir, '..');
const coreSource = await fs.readFile(path.join(rootDir, 'src/core.js'), 'utf8');
const contentSource = await fs.readFile(path.join(rootDir, 'src/content.js'), 'utf8');

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

test('内容脚本翻译固定界面、跳过正文、处理动态元素并可逆恢复', async () => {
  const dom = new JSDOM(`<!doctype html><html><head><title>Account settings</title></head><body>
    <nav><a id="nav-settings">Settings</a></nav>
    <main><h1>Settings</h1><button id="unknown">Mystery Command</button></main>
    <article class="markdown-body"><p id="readme">Settings</p></article>
  </body></html>`, {
    url: 'https://github.com/settings/profile',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });

  const auditBatches = [];
  const storageListeners = [];
  const messageListeners = [];
  dom.window.chrome = {
    runtime: {
      lastError: null,
      sendMessage(message, callback) {
        if (message.type === 'audit:recordBatch') auditBatches.push(message.entries);
        callback?.({ saved: message.entries?.length ?? 0 });
      },
      onMessage: { addListener(listener) { messageListeners.push(listener); } }
    },
    storage: {
      local: {
        async get() { return { settings: { enabled: true, showOriginal: true, auditEnabled: true } }; }
      },
      onChanged: { addListener(listener) { storageListeners.push(listener); } }
    }
  };
  dom.window.GITHUB_ZH_DICTIONARY = {
    meta: { generatedAt: '2026-08-01T00:00:00Z', upstreamSha: 'a'.repeat(40) },
    base: {
      exact: { Settings: '设置', 'Save changes': '保存更改' },
      regex: [],
      titles: { 'Account settings': '账户设置' }
    },
    scopes: {
      public: { exact: {}, regex: [], titles: {} },
      'settings-menu': { exact: {}, regex: [], titles: {} },
      'settings/profile': { exact: {}, regex: [], titles: {} }
    }
  };
  dom.window.GITHUB_ZH_OFFICIAL_OVERRIDES = { exact: {}, titles: {} };

  dom.window.eval(coreSource);
  dom.window.eval(contentSource);
  await wait(180);

  assert.equal(dom.window.document.getElementById('nav-settings').textContent, '设置');
  assert.equal(dom.window.document.querySelector('main h1').textContent, '设置');
  assert.equal(dom.window.document.getElementById('readme').textContent, 'Settings');
  assert.equal(dom.window.document.title, '账户设置');

  const dynamic = dom.window.document.createElement('button');
  dynamic.id = 'dynamic';
  dynamic.textContent = 'Save changes';
  dom.window.document.querySelector('main').append(dynamic);
  await wait(180);
  assert.equal(dynamic.textContent, '保存更改');
  assert.equal(dynamic.dataset.githubZhOriginal, 'Save changes');

  await wait(1250);
  assert.equal(auditBatches.flat().some((entry) => entry.text === 'Mystery Command'), true);
  assert.equal(auditBatches.flat().some((entry) => entry.text === 'Settings' && entry.pageType.includes('readme')), false);

  storageListeners[0]({
    settings: { newValue: { enabled: false, showOriginal: true, auditEnabled: true } }
  }, 'local');
  await wait(100);
  assert.equal(dom.window.document.getElementById('nav-settings').textContent, 'Settings');
  assert.equal(dynamic.textContent, 'Save changes');
  assert.equal(dom.window.document.title, 'Account settings');

  dom.window.close();
});
