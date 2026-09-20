import { test, expect, chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const projects = [
  { name: 'figma-zh-ui', origin: 'https://www.figma.com', path: '/files/recent', nextPath: '/design/synthetic/example' },
  { name: 'github-zh-ui', origin: 'https://github.com', path: '/synthetic/repository', nextPath: '/synthetic/repository/settings' }
];

function fixture(project) {
  const protectedMarkup = project.name === 'figma-zh-ui'
    ? '<a href="/design/synthetic/example"><span id="protected">Settings</span></a><div data-testid="folder-name">Synthetic private folder</div>'
    : '<div class="markdown-body" id="protected">Settings</div><div class="js-comment-body">Synthetic private comment</div>';
  return '<!doctype html><html><head><meta charset="utf-8"><title>Synthetic test</title></head><body>'
    + '<nav><button id="settings">Settings</button></nav><main></main>' + protectedMarkup
    + '<input id="user-input" value="Settings"><div role="dialog" id="dialog"></div>'
    + (project.name === 'figma-zh-ui' ? '<div translate="no"><i18n-text id="label">Auto <span>layout</span></i18n-text><button id="hint" title="Search"></button></div>' : '')
    + '</body></html>';
}

async function loadExtension(project) {
  const extensionPath = fileURLToPath(new URL('../../' + project.name, import.meta.url));
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium', headless: true, acceptDownloads: true,
    args: ['--disable-extensions-except=' + extensionPath, '--load-extension=' + extensionPath]
  });
  try {
    // Only synthetic fixtures reach the browser. The original manifest and real
    // extension APIs are used; no manifest edits or chrome.* substitutes.
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if ([project.origin, 'https://example.test'].includes(url.origin)) {
        await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fixture(project) });
      } else if (url.protocol === 'chrome-extension:') {
        await route.continue();
      } else await route.abort();
    });
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).hostname;
    expect(worker.url()).toBe('chrome-extension://' + extensionId + '/src/background.js');
    expect(await worker.evaluate(() => chrome.runtime.id)).toBe(extensionId);
    await worker.evaluate(async () => {
      await chrome.storage.local.set({ settings: { enabled: true, showOriginal: true, auditEnabled: true }, auditEntries: [] });
    });
    const page = await context.newPage();
    await page.goto(project.origin + project.path);
    return { context, worker, extensionId, page };
  } catch (error) {
    await context.close();
    throw error;
  }
}

async function auditEntries(worker) {
  return worker.evaluate(async () => (await chrome.storage.local.get('auditEntries')).auditEntries ?? []);
}

for (const project of projects) {
  test(project.name + ': original MV3 manifest, isolated injection, DOM lifecycle and popup settings', async () => {
    const { context, worker, extensionId, page } = await loadExtension(project);
    try {
      await expect(page.locator('#settings')).toHaveText('设置');
      await expect(page.locator('#protected')).toHaveText('Settings');
      await expect(page.locator('#user-input')).toHaveValue('Settings');
      expect(await page.evaluate(() => typeof globalThis.FigmaZhCore + ':' + typeof globalThis.GitHubZhCore)).toBe('undefined:undefined');
      if (project.name === 'figma-zh-ui') {
        await expect(page.locator('#label')).toHaveText('自动布局');
        await expect(page.locator('#hint')).toHaveAttribute('title', '搜索');
      }
      await page.evaluate((nextPath) => {
        history.pushState({}, '', nextPath);
        const button = document.createElement('button');
        button.id = 'dynamic';
        button.textContent = 'Settings';
        document.querySelector('main').append(button);
      }, project.nextPath);
      await expect(page.locator('#dynamic')).toHaveText('设置');
      await expect(page.locator('#settings')).toHaveText('设置');
      await page.locator('#dynamic').evaluate((element) => element.setAttribute('contenteditable', ''));
      await expect(page.locator('#dynamic')).toHaveText('Settings');
      await page.locator('#dynamic').evaluate((element) => element.removeAttribute('contenteditable'));
      await expect(page.locator('#dynamic')).toHaveText('设置');

      // The popup is opened as an extension page; actual toolbar popup geometry
      // and activeTab user-gesture behavior remain part of manual acceptance.
      const popup = await context.newPage();
      await popup.goto('chrome-extension://' + extensionId + '/src/popup.html');
      await expect(popup.locator('#enabled')).toBeChecked();
      await popup.locator('#enabled').uncheck();
      await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get('settings')).settings.enabled)).toBe(false);
      await expect(page.locator('#settings')).toHaveText('Settings');
      await expect(page.locator('#dynamic')).toHaveText('Settings');
      if (project.name === 'figma-zh-ui') {
        await expect(page.locator('#hint')).toHaveAttribute('title', 'Search');
        await expect(page.locator('#label')).toHaveText('Auto layout');
        await expect(page.locator('#label span')).toHaveText('layout');
      }
      await popup.locator('#enabled').check();
      await expect(page.locator('#settings')).toHaveText('设置');

      const outside = await context.newPage();
      await outside.goto('https://example.test/non-target');
      await outside.waitForTimeout(300);
      await expect(outside.locator('#settings')).toHaveText('Settings');
      expect(await outside.locator('[data-figma-zh-original],[data-github-zh-original]').count()).toBe(0);
    } finally { await context.close(); }
  });

  test(project.name + ': real audit messaging, local storage, popup export and disabled queue', async () => {
    const { context, worker, extensionId, page } = await loadExtension(project);
    try {
      await expect(page.locator('#settings')).toHaveText('设置');
      await page.locator('#dialog').evaluate((dialog) => {
        const action = document.createElement('button');
        action.textContent = 'Synthetic mystery action';
        dialog.append(action);
      });
      await expect.poll(async () => (await auditEntries(worker)).map(({ text }) => text)).toEqual(['Synthetic mystery action']);
      const popup = await context.newPage();
      await popup.goto('chrome-extension://' + extensionId + '/src/popup.html');
      await expect(popup.locator('#audit-total')).toHaveText('1');
      const downloadReady = popup.waitForEvent('download');
      await popup.locator('#export-audit').click();
      const download = await downloadReady;
      const report = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
      expect(report.entries).toHaveLength(1);
      expect(report.entries[0].text).toBe('Synthetic mystery action');
      expect(Object.keys(report.entries[0]).sort()).toEqual(['count', 'firstSeen', 'lastSeen', 'pageType', 'text']);
      expect(JSON.stringify(report.entries)).not.toContain('Synthetic private');
      expect(JSON.stringify(report.entries)).not.toContain(project.origin);
      await popup.locator('#clear-audit').click();
      await expect.poll(() => auditEntries(worker)).toEqual([]);
      await page.locator('#dialog').evaluate((dialog) => {
        const action = document.createElement('button');
        action.textContent = 'Synthetic pending action';
        dialog.append(action);
      });
      await expect(page.locator('#dialog button').last()).toHaveAttribute('data-' + (project.name === 'figma-zh-ui' ? 'figma' : 'github') + '-zh-unknown', 'true');
      await popup.locator('#audit-enabled').uncheck();
      await page.waitForTimeout(1400);
      expect(await auditEntries(worker)).toEqual([]);
    } finally { await context.close(); }
  });
}
