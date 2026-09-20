import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const coreSource = await fs.readFile(new URL('../src/core.js', import.meta.url), 'utf8');
const contentSource = await fs.readFile(new URL('../src/content.js', import.meta.url), 'utf8');
const wait = (ms = 130) => new Promise((resolve) => setTimeout(resolve, ms));

async function boot(t, html, overrides = {}) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
    url: 'https://www.figma.com/files/recent', runScripts: 'outside-only', pretendToBeVisual: true
  });
  t.after(() => dom.window.close());
  const batches = [];
  let onStorage;
  let onMessage;
  const settings = { enabled: true, showOriginal: true, auditEnabled: true };
  dom.window.chrome = {
    runtime: {
      lastError: null,
      sendMessage(message, callback) { batches.push(message.entries); callback?.({}); },
      onMessage: { addListener(listener) { onMessage = listener; } }
    },
    storage: {
      local: { async get() { return { settings }; } },
      onChanged: { addListener(listener) { onStorage = listener; } }
    }
  };
  dom.window.FIGMA_ZH_DICTIONARY = {
    meta: {}, exact: { Search: '搜索', Settings: '设置', Share: '分享', 'Auto layout': '自动布局' }, patterns: []
  };
  dom.window.FIGMA_ZH_OFFICIAL_OVERRIDES = overrides;
  dom.window.eval(coreSource);
  dom.window.eval(contentSource);
  await wait();
  return {
    window: dom.window, document: dom.window.document, batches,
    update(patch) {
      Object.assign(settings, patch);
      onStorage({ settings: { newValue: { ...settings } } }, 'local');
    },
    status() { let result; onMessage({ type: 'content:getStatus' }, {}, (value) => { result = value; }); return result; }
  };
}

test('翻译固定控件 title 并恢复原属性，输入值和输入标签保持原样', async (t) => {
  const app = await boot(t, '<button id="action" title="Auto layout">Search</button><input id="input" value="Search" title="Search" placeholder="Search">');
  const button = app.document.querySelector('#action');
  assert.equal(button.title, '自动布局');
  const input = app.document.querySelector('#input');
  assert.equal(input.value, 'Search');
  assert.equal(input.title, 'Search');
  assert.equal(input.placeholder, 'Search');
  app.update({ enabled: false });
  assert.equal(button.title, 'Auto layout');
  assert.equal(button.textContent, 'Search');
});

test('translate=no 普通面板的固定控件可译，名称、代码和普通文本仍保护', async (t) => {
  const app = await boot(t, `<div translate="no">
    <button id="action">Search</button><div role="tooltip" id="hint">Auto layout</div>
    <span id="plain">Settings</span><code><button id="code">Search</button></code>
    <a href="/design/synthetic/example"><button id="file">Search</button></a>
    <div data-testid="variable-name"><button id="variable">Search</button></div>
  </div>`);
  assert.equal(app.document.querySelector('#action').textContent, '搜索');
  assert.equal(app.document.querySelector('#hint').textContent, '自动布局');
  for (const id of ['code', 'file', 'variable']) assert.equal(app.document.getElementById(id).textContent, 'Search');
  assert.equal(app.document.querySelector('#plain').textContent, 'Settings');
});

test('跨格式节点的 i18n 整句保持节点身份和事件，关闭后逐节点恢复', async (t) => {
  const app = await boot(t, '<i18n-text id="label">Auto <span>layout</span></i18n-text>');
  const label = app.document.querySelector('#label');
  const span = label.querySelector('span');
  let clicks = 0;
  span.addEventListener('click', () => { clicks += 1; });
  assert.equal(label.textContent, '自动布局');
  assert.equal(label.querySelector('span'), span);
  assert.equal(label.dataset.figmaZhOriginal, 'Auto layout');
  assert.equal(span.attributes.length, 0);
  app.document.body.append(app.document.createElement('div'));
  await wait(70);
  assert.equal(label.textContent, '自动布局');
  assert.equal(label.dataset.figmaZhOriginal, 'Auto layout');
  assert.equal(span.attributes.length, 0);
  span.click();
  assert.equal(clicks, 1);
  app.update({ enabled: false });
  assert.equal(label.firstChild.nodeValue, 'Auto ');
  assert.equal(span.textContent, 'layout');
  app.update({ enabled: true });
  await wait();
  assert.equal(label.textContent, '自动布局');
  label.replaceChildren('Auto ', app.document.createElement('span'));
  label.lastChild.textContent = 'layout';
  await wait();
  assert.equal(label.textContent, '自动布局');
});

test('i18n 内受保护的动态占位名称不能被整句替换', async (t) => {
  const app = await boot(t, '<i18n-text id="label">Auto <span data-testid="layer-name">layout</span></i18n-text>');
  assert.equal(app.document.querySelector('#label').textContent, 'Auto layout');
});

test('组合标签子节点被复用为用户名称时整体恢复原始文案', async (t) => {
  const app = await boot(t, '<i18n-text id="label">Auto <span>layout</span></i18n-text>');
  const label = app.document.querySelector('#label');
  assert.equal(label.textContent, '自动布局');
  label.querySelector('span').setAttribute('data-testid', 'layer-name');
  await wait();
  assert.equal(label.textContent, 'Auto layout');
  app.update({ enabled: false });
  assert.equal(label.textContent, 'Auto layout');
});

test('SPA 路由变化强制重扫保留的菜单，不只扫描新插入节点', async (t) => {
  const app = await boot(t, '<button id="nav">Search</button><main></main>', {
    routes: { files: { Search: '文件搜索' }, editor: { Search: '编辑器搜索' } }
  });
  assert.equal(app.document.querySelector('#nav').textContent, '文件搜索');
  app.window.history.pushState({}, '', '/design/synthetic/example');
  app.document.querySelector('main').append(app.document.createElement('div'));
  await wait(230);
  assert.equal(app.document.querySelector('#nav').textContent, '编辑器搜索');
  assert.equal(app.status().pageType, 'editor');
});

test('仅 pushState 而无 DOM 变化也更新路由词条', async (t) => {
  const app = await boot(t, '<button id="nav">Search</button>', {
    routes: { settings: { Search: '设置搜索' } }
  });
  app.window.history.pushState({}, '', '/settings');
  await wait(620);
  assert.equal(app.document.querySelector('#nav').textContent, '设置搜索');
});

test('移除的译文恢复原文，关闭后重新插入不会残留中文', async (t) => {
  const app = await boot(t, '<button id="action" title="Search">Share</button>');
  const button = app.document.querySelector('#action');
  button.remove();
  await wait();
  assert.equal(button.textContent, 'Share');
  assert.equal(button.title, 'Search');
  assert.equal(button.dataset.figmaZhOriginal, undefined);
  app.update({ enabled: false });
  app.document.body.append(button);
  await wait();
  assert.equal(button.textContent, 'Share');
});

test('关闭扩展时尚未处理的移除节点也能恢复', async (t) => {
  const app = await boot(t, '<button id="action">Search</button>');
  const button = app.document.querySelector('#action');
  button.remove();
  app.update({ enabled: false });
  assert.equal(button.textContent, 'Search');
});

test('页面更新文案后关闭，不覆盖新值或保留过期恢复记录', async (t) => {
  const app = await boot(t, '<button id="action" title="Search">Search</button>');
  const button = app.document.querySelector('#action');
  button.firstChild.nodeValue = '新文案';
  button.title = '新提示';
  await wait();
  assert.equal(button.dataset.figmaZhOriginal, undefined);
  button.firstChild.nodeValue = '搜索';
  button.title = '搜索';
  await wait();
  app.update({ enabled: false });
  assert.equal(button.textContent, '搜索');
  assert.equal(button.title, '搜索');
});

test('可编辑空属性/plaintext-only、多 class 名称与变量名保护', async (t) => {
  const app = await boot(t, `<div contenteditable><button id="empty">Search</button></div>
    <div contenteditable="plaintext-only" id="plain">Search</div>
    <div class="layout layer_name label" id="layer">Search</div>
    <div class="layout variable_name label" id="variable">Search</div>
    <div class="layout folder_name--root" id="folder">Search</div>
    <div data-testid="folder-name" id="folder-testid">Search</div>
    <div data-testid="workspace-name" id="workspace">Search</div>
    <div contenteditable="false"><button id="fixed">Search</button></div>`);
  for (const id of ['empty', 'plain', 'layer', 'variable', 'folder', 'folder-testid', 'workspace']) assert.equal(app.document.getElementById(id).textContent, 'Search');
  assert.equal(app.document.getElementById('fixed').textContent, '搜索');
});

test('拖拽卡片和名称保护，已知文件浏览器容器不阻断固定导航', async (t) => {
  const app = await boot(t, `<div draggable="true" class="file_browser--canvas--synthetic">
    <button id="nav">Search</button><button draggable="true" id="item">Search</button>
    <div draggable="true"><span id="name">Settings</span></div>
  </div>`);
  assert.equal(app.document.querySelector('#nav').textContent, '搜索');
  assert.equal(app.document.querySelector('#item').textContent, 'Search');
  assert.equal(app.document.querySelector('#name').textContent, 'Settings');
});

test('已译节点进入受保护区域时还原，退出后恢复翻译', async (t) => {
  const app = await boot(t, '<div id="area"><button>Search</button></div>');
  const area = app.document.querySelector('#area');
  area.setAttribute('contenteditable', '');
  await wait();
  assert.equal(area.textContent, 'Search');
  area.removeAttribute('contenteditable');
  await wait();
  assert.equal(area.textContent, '搜索');
});

for (const patch of [{ enabled: false }, { auditEnabled: false }]) {
  test(`关闭 ${Object.keys(patch)[0]} 会取消未发送审计及高亮`, async (t) => {
    const app = await boot(t, '<div role="dialog"><button id="unknown">Mystery action</button></div>');
    assert.equal(app.status().unknownCount, 1);
    app.update(patch);
    await wait(1250);
    assert.equal(app.batches.length, 0);
    assert.equal(app.status().unknownCount, 0);
    assert.equal(app.document.querySelector('#unknown').dataset.figmaZhUnknown, undefined);
  });
}

test('人工确认保留的品牌不进入漏译审计', async (t) => {
  const app = await boot(t, '<div role="dialog"><button>FigJam</button></div>', { exact: { FigJam: 'FigJam' } });
  await wait(1250);
  assert.equal(app.document.querySelector('button').textContent, 'FigJam');
  assert.equal(app.status().unknownCount, 0);
  assert.equal(app.batches.length, 0);
});

test('延迟原文提示不会显示已失效或受保护的标签', async (t) => {
  const app = await boot(t, '<button id="action">Search</button>');
  const button = app.document.querySelector('#action');
  button.dispatchEvent(new app.window.Event('pointerover', { bubbles: true }));
  button.setAttribute('contenteditable', '');
  await wait(520);
  assert.equal(app.document.querySelector('[data-visible="true"]'), null);
  assert.equal(button.textContent, 'Search');
});

test('审计发送前重新检查来源，已移除、改写或变为名称的候选不保存', async (t) => {
  const app = await boot(t, `<div role="dialog">
    <button id="protected">Synthetic private folder</button>
    <button id="removed">Synthetic removed action</button>
    <button id="changed">Synthetic outdated action</button>
    <button id="attribute" aria-label="Synthetic outdated label"></button>
  </div>`);
  app.document.querySelector('#protected').setAttribute('data-testid', 'project-name');
  app.document.querySelector('#removed').remove();
  app.document.querySelector('#changed').firstChild.nodeValue = 'Search';
  app.document.querySelector('#attribute').removeAttribute('aria-label');
  await wait(1300);
  assert.equal(app.batches.length, 0);
  assert.equal(app.status().unknownCount, 0);
});

test('同一审计词仍有安全来源时只发送标准化记录，不携带DOM信息', async (t) => {
  const app = await boot(t, '<div role="dialog"><button id="removed">Synthetic action</button><button>Synthetic action</button></div>');
  app.document.querySelector('#removed').remove();
  await wait(1300);
  assert.equal(app.batches.flat().length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(app.batches.flat()[0])), { text: 'Synthetic action', pageType: 'files' });
});
