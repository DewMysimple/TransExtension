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

async function createRuntime(t, html, options = {}) {
  const dom = new JSDOM(`<!doctype html><html><head><title>Account settings</title></head><body>${html}</body></html>`, {
    url: `https://github.com${options.pathname ?? '/settings/profile'}`,
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  t.after(() => dom.window.close());

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
      exact: { Settings: '设置', 'Save changes': '保存更改', Close: '关闭', GitHub: 'GitHub' },
      regex: [],
      titles: { 'Account settings': '账户设置' }
    },
    scopes: {
      public: { exact: {}, regex: [], titles: {} },
      'settings-menu': { exact: {}, regex: [], titles: {} },
      'settings/profile': { exact: {}, regex: [], titles: {} },
      ...options.scopes
    }
  };
  dom.window.GITHUB_ZH_OFFICIAL_OVERRIDES = { exact: {}, titles: {} };

  dom.window.eval(coreSource);
  dom.window.eval(contentSource);
  await wait(180);
  return {
    window: dom.window,
    document: dom.window.document,
    auditBatches,
    setSettings(patch) {
      const settings = { enabled: true, showOriginal: true, auditEnabled: true, ...patch };
      for (const listener of storageListeners) listener({ settings: { newValue: settings } }, 'local');
    },
    status() {
      let response;
      for (const listener of messageListeners) {
        listener({ type: 'content:getStatus' }, {}, (value) => { response = value; });
      }
      return response;
    }
  };
}

test('内容脚本翻译固定界面、跳过正文、处理动态元素并可逆恢复', async (t) => {
  const runtime = await createRuntime(t, `
    <nav><a id="nav-settings">Settings</a></nav>
    <main><h1>Settings</h1><button id="unknown">Mystery Command</button></main>
    <article class="markdown-body"><p id="readme">Settings</p></article>
  `);
  const { document, auditBatches } = runtime;

  assert.equal(document.getElementById('nav-settings').textContent, '设置');
  assert.equal(document.querySelector('main h1').textContent, '设置');
  assert.equal(document.getElementById('readme').textContent, 'Settings');
  assert.equal(document.title, '账户设置');

  const dynamic = document.createElement('button');
  dynamic.id = 'dynamic';
  dynamic.textContent = 'Save changes';
  document.querySelector('main').append(dynamic);
  await wait(180);
  assert.equal(dynamic.textContent, '保存更改');
  assert.equal(dynamic.dataset.githubZhOriginal, 'Save changes');

  await wait(1250);
  assert.equal(auditBatches.flat().some((entry) => entry.text === 'Mystery Command'), true);
  assert.equal(auditBatches.flat().some((entry) => entry.text === 'Settings' && entry.pageType.includes('readme')), false);

  runtime.setSettings({ enabled: false });
  await wait(100);
  assert.equal(document.getElementById('nav-settings').textContent, 'Settings');
  assert.equal(dynamic.textContent, 'Save changes');
  assert.equal(document.title, 'Account settings');
});

test('原文悬浮提示保持英文，关闭悬浮设置立即隐藏', async (t) => {
  const runtime = await createRuntime(t, '<button id="control">Settings</button>');
  const control = runtime.document.getElementById('control');
  control.dispatchEvent(new runtime.window.Event('pointerover', { bubbles: true }));
  await wait(650);
  const tooltip = runtime.document.getElementById('github-zh-ui-original-tooltip');
  assert.equal(tooltip.textContent, 'Settings');
  assert.equal(tooltip.dataset.visible, 'true');
  runtime.setSettings({ showOriginal: false });
  assert.equal(tooltip.dataset.visible, 'false');
});

test('延迟悬浮提示读取当前原文，不显示已失效的旧标签', async (t) => {
  const runtime = await createRuntime(t, '<button id="control">Settings</button>');
  const control = runtime.document.getElementById('control');
  control.dispatchEvent(new runtime.window.Event('pointerover', { bubbles: true }));
  control.firstChild.nodeValue = 'Save changes';
  await wait(650);
  assert.equal(runtime.document.getElementById('github-zh-ui-original-tooltip').textContent, 'Save changes');
});

test('提交按钮改为文本输入框时先恢复 value，之后不翻译输入值', async (t) => {
  const runtime = await createRuntime(t, '<input id="control" type="submit" value="Save changes">');
  const control = runtime.document.getElementById('control');
  assert.equal(control.value, '保存更改');
  control.type = 'text';
  await wait(180);
  assert.equal(control.value, 'Save changes');
  control.value = 'Settings';
  runtime.setSettings({ enabled: false });
  assert.equal(control.value, 'Settings');
});

test('框架更新控件时清理旧原文，关闭时不覆盖应用新文字', async (t) => {
  const runtime = await createRuntime(t, '<button id="control">Settings</button><input id="search" placeholder="Settings">');
  const control = runtime.document.getElementById('control');
  const search = runtime.document.getElementById('search');
  control.firstChild.nodeValue = 'Save changes';
  search.setAttribute('placeholder', 'Save changes');
  await wait(180);
  assert.equal(control.textContent, '保存更改');
  assert.equal(control.dataset.githubZhOriginal, 'Save changes');
  assert.equal(search.dataset.githubZhOriginal, 'Save changes');
  control.firstChild.nodeValue = '应用新内容';
  search.setAttribute('placeholder', '新的提示');
  await wait(180);
  assert.equal(control.hasAttribute('data-github-zh-original'), false);
  assert.equal(search.hasAttribute('data-github-zh-original'), false);
  runtime.setSettings({ enabled: false });
  assert.equal(control.textContent, '应用新内容');
  assert.equal(search.getAttribute('placeholder'), '新的提示');
});

test('移除的译文恢复并释放，再插入或关闭时不遗留中文', async (t) => {
  const runtime = await createRuntime(t, '<section id="panel"><button>Settings</button><input placeholder="Save changes"></section>');
  const panel = runtime.document.getElementById('panel');
  panel.remove();
  await wait(180);
  assert.equal(panel.querySelector('button').textContent, 'Settings');
  assert.equal(panel.querySelector('input').getAttribute('placeholder'), 'Save changes');
  assert.equal(panel.querySelector('[data-github-zh-original]'), null);
  runtime.document.body.append(panel);
  await wait(180);
  assert.equal(panel.querySelector('button').textContent, '设置');
  panel.remove();
  runtime.setSettings({ enabled: false });
  runtime.document.body.append(panel);
  await wait(180);
  assert.equal(panel.querySelector('button').textContent, 'Settings');
  assert.equal(panel.querySelector('input').getAttribute('placeholder'), 'Save changes');
});

test('空值和纯文本编辑区域受保护，移动及属性变化及时恢复英文', async (t) => {
  const runtime = await createRuntime(t, `
    <div contenteditable><button id="empty-edit">Settings</button></div>
    <div contenteditable="plaintext-only"><span id="plain-edit">Settings</span></div>
    <div translate="no"><button id="no-translate">Settings</button></div>
    <section id="changing"><button>Settings</button></section>
    <button id="moving">Save changes</button><article class="markdown-body" id="body"></article>
  `);
  const { document } = runtime;
  for (const id of ['empty-edit', 'plain-edit', 'no-translate']) {
    assert.equal(document.getElementById(id).textContent, 'Settings');
  }
  const changing = document.getElementById('changing');
  const moving = document.getElementById('moving');
  changing.setAttribute('contenteditable', '');
  document.getElementById('body').append(moving);
  await wait(180);
  assert.equal(changing.textContent, 'Settings');
  assert.equal(moving.textContent, 'Save changes');
  assert.equal(moving.hasAttribute('data-github-zh-original'), false);
  changing.removeAttribute('contenteditable');
  await wait(180);
  assert.equal(changing.textContent, '设置');
});

test('仅改变容器 id 进入 README 保护区域时立即恢复英文', async (t) => {
  const runtime = await createRuntime(t, '<div id="panel"><button>Settings</button></div>');
  const panel = runtime.document.getElementById('panel');
  assert.equal(panel.textContent, '设置');
  panel.id = 'readme';
  await wait(180);
  assert.equal(panel.textContent, 'Settings');
  assert.equal(panel.querySelector('button').hasAttribute('data-github-zh-original'), false);
  panel.id = 'panel';
  await wait(180);
  assert.equal(panel.textContent, '设置');
});

test('路由变化后的局部 DOM 更新会重新扫描整页并使用新页面词条', async (t) => {
  const runtime = await createRuntime(t, '<nav><button id="control">Settings</button></nav><main></main>', {
    scopes: { 'settings/appearance': { exact: { Settings: '外观设置' }, regex: [], titles: {} } }
  });
  runtime.window.history.pushState({}, '', '/settings/appearance');
  runtime.document.querySelector('main').append(runtime.document.createElement('div'));
  await wait(200);
  assert.equal(runtime.document.getElementById('control').textContent, '外观设置');
  assert.equal(runtime.status().pageType, 'settings/appearance');
  runtime.window.history.pushState({}, '', '/settings/profile');
  runtime.window.dispatchEvent(new runtime.window.PopStateEvent('popstate'));
  await wait(180);
  assert.equal(runtime.document.getElementById('control').textContent, '设置');
  runtime.window.history.pushState({}, '', '/settings/appearance');
  await wait(650);
  assert.equal(runtime.document.getElementById('control').textContent, '外观设置');
});

test('词库明确保留的品牌名不计为漏译', async (t) => {
  const runtime = await createRuntime(t, '<button>GitHub</button>');
  assert.equal(runtime.document.querySelector('button').textContent, 'GitHub');
  assert.equal(runtime.status().unknownCount, 0);
});

test('关闭扩展或审计会丢弃尚未发送的候选，重新开启可继续收集', async (t) => {
  for (const patch of [{ enabled: false }, { auditEnabled: false }]) {
    const runtime = await createRuntime(t, '<button>Mystery Command</button>');
    runtime.setSettings(patch);
    assert.equal(runtime.status().unknownCount, 0);
    await wait(1350);
    assert.equal(runtime.auditBatches.length, 0);
    runtime.setSettings({});
    await wait(1350);
    assert.equal(runtime.auditBatches.flat().some((entry) => entry.text === 'Mystery Command'), true);
  }
});

test('审计只保存固定页面类别，不包含环境名或应用名', async (t) => {
  const runtime = await createRuntime(t, '<button>Mystery Command</button>', {
    pathname: '/synthetic-owner/synthetic-repository/settings/environments/SyntheticPrivateEnvironment'
  });
  await wait(1250);
  assert.equal(runtime.auditBatches.flat()[0].pageType, 'repository/settings/environments');
  assert.equal(JSON.stringify(runtime.auditBatches).includes('SyntheticPrivateEnvironment'), false);
});

test('审计发送前重新检查来源，剔除已变正文、改写、移除和删除属性的候选', async (t) => {
  const runtime = await createRuntime(t, `
    <button id="protected">Protected Candidate</button>
    <button id="changed">Changed Candidate</button>
    <button id="removed">Removed Candidate</button>
    <button id="attribute" data-confirm="Attribute Candidate">Close</button>
    <button id="attribute-protected" data-confirm="Protected Attribute Candidate">Close</button>
    <button id="attribute-changed" data-confirm="Changed Attribute Candidate">Close</button>
    <button id="valid" data-confirm="Valid Attribute Candidate">Close</button>
  `);
  runtime.document.getElementById('protected').dataset.testid = 'issue-title';
  runtime.document.getElementById('changed').firstChild.nodeValue = 'Settings';
  runtime.document.getElementById('removed').remove();
  runtime.document.getElementById('attribute').removeAttribute('data-confirm');
  runtime.document.getElementById('attribute-protected').dataset.testid = 'issue-title';
  runtime.document.getElementById('attribute-changed').setAttribute('data-confirm', 'Settings');
  await wait(1300);
  const entries = runtime.auditBatches.flat();
  assert.deepEqual(entries.map((entry) => entry.text), ['Valid Attribute Candidate']);
  assert.deepEqual(Object.keys(entries[0]).sort(), ['pageType', 'text']);
});

test('相同候选的多个来源中仍有安全控件时只保存一次', async (t) => {
  const runtime = await createRuntime(t, `
    <button id="first">Shared Candidate</button><button id="second">Shared Candidate</button>
    <button id="third" data-confirm="Shared Candidate">Close</button>
  `);
  runtime.document.getElementById('first').dataset.testid = 'issue-title';
  runtime.document.getElementById('second').remove();
  await wait(1300);
  const entries = runtime.auditBatches.flat();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].text, 'Shared Candidate');
  assert.deepEqual(Object.keys(entries[0]).sort(), ['pageType', 'text']);
});

test('路由切换时旧页面候选不作为新页面审计保存', async (t) => {
  const runtime = await createRuntime(t, '<button id="old">Previous Page Candidate</button>');
  runtime.window.history.pushState({}, '', '/owner/repository/issues');
  runtime.document.getElementById('old').dataset.testid = 'issue-title';
  await wait(1400);
  assert.equal(runtime.auditBatches.length, 0);
  assert.equal(runtime.status().pageType, 'repository/issues');
});
