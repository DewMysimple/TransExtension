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

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test('翻译固定控件、保护文件和图层名称、处理动态菜单并可逆恢复', async () => {
  const dom = new JSDOM(`<!doctype html><html><body>
    <nav><button id="recent">Recently viewed</button><button id="search" aria-label="Search">Search</button></nav>
    <div class="file_browser--canvas--root" draggable="true">
      <a id="sidebar-recents" role="link" href="/files/recent">Recents</a>
      <button id="canvas-community">Community</button>
    </div>
    <main>
      <a href="/design/abc/My-file"><span id="file-name">Search</span></a>
      <div class="layer_name--row"><span id="layer-name">Settings</span></div>
      <div role="dialog"><button id="unknown">Mystery action</button></div>
      <div contenteditable="true" id="editable">Settings</div>
    </main>
  </body></html>`, {
    url: 'https://www.figma.com/files/team/123/recents-and-sharing/recently-viewed',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });

  const auditBatches = [];
  const storageListeners = [];
  dom.window.chrome = {
    runtime: {
      lastError: null,
      sendMessage(message, callback) {
        if (message.type === 'audit:recordBatch') auditBatches.push(message.entries);
        callback?.({ saved: message.entries?.length ?? 0 });
      },
      onMessage: { addListener() {} }
    },
    storage: {
      local: { async get() { return { settings: { enabled: true, showOriginal: true, auditEnabled: true } }; } },
      onChanged: { addListener(listener) { storageListeners.push(listener); } }
    }
  };
  dom.window.FIGMA_ZH_DICTIONARY = {
    meta: { generatedAt: '2026-08-13T00:00:00Z', upstreamSha: 'a'.repeat(40) },
    exact: { Search: '搜索', Settings: '设置', 'Recently viewed': '最近查看', Recents: '最近使用', Community: '社区', Share: '分享' },
    patterns: []
  };
  dom.window.FIGMA_ZH_OFFICIAL_OVERRIDES = { exact: {}, routes: {} };
  dom.window.eval(coreSource);
  dom.window.eval(contentSource);
  await wait(180);

  assert.equal(dom.window.document.getElementById('recent').textContent, '最近查看');
  assert.equal(dom.window.document.getElementById('search').textContent, '搜索');
  assert.equal(dom.window.document.getElementById('search').getAttribute('aria-label'), '搜索');
  assert.equal(dom.window.document.getElementById('sidebar-recents').textContent, '最近使用');
  assert.equal(dom.window.document.getElementById('canvas-community').textContent, '社区');
  assert.equal(dom.window.document.getElementById('file-name').textContent, 'Search');
  assert.equal(dom.window.document.getElementById('layer-name').textContent, 'Settings');
  assert.equal(dom.window.document.getElementById('editable').textContent, 'Settings');

  const dynamic = dom.window.document.createElement('button');
  dynamic.textContent = 'Share';
  dom.window.document.querySelector('main').append(dynamic);
  await wait(180);
  assert.equal(dynamic.textContent, '分享');
  assert.equal(dynamic.dataset.figmaZhOriginal, 'Share');

  await wait(1250);
  assert.equal(auditBatches.flat().some((entry) => entry.text === 'Mystery action'), true);
  assert.equal(auditBatches.flat().some((entry) => entry.text === 'Search' && entry.pageType === 'files'), false);

  storageListeners[0]({ settings: { newValue: { enabled: false, showOriginal: true, auditEnabled: true } } }, 'local');
  await wait(100);
  assert.equal(dom.window.document.getElementById('recent').textContent, 'Recently viewed');
  assert.equal(dom.window.document.getElementById('search').textContent, 'Search');
  assert.equal(dom.window.document.getElementById('search').getAttribute('aria-label'), 'Search');
  assert.equal(dom.window.document.getElementById('sidebar-recents').textContent, 'Recents');
  assert.equal(dom.window.document.getElementById('canvas-community').textContent, 'Community');
  assert.equal(dynamic.textContent, 'Share');
  dom.window.close();
});
