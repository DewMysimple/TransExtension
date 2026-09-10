(function runPopup() {
  'use strict';

  const DEFAULT_SETTINGS = Object.freeze({ enabled: true, showOriginal: true, auditEnabled: true });
  const elements = {
    enabled: document.getElementById('enabled'),
    showOriginal: document.getElementById('show-original'),
    auditEnabled: document.getElementById('audit-enabled'),
    pageStatus: document.getElementById('page-status'),
    translatedCount: document.getElementById('translated-count'),
    unknownCount: document.getElementById('unknown-count'),
    auditTotal: document.getElementById('audit-total'),
    sourceVersion: document.getElementById('source-version'),
    sourceDate: document.getElementById('source-date'),
    rescan: document.getElementById('rescan'),
    exportAudit: document.getElementById('export-audit'),
    clearAudit: document.getElementById('clear-audit')
  };
  let settings = { ...DEFAULT_SETTINGS };
  let auditEntries = [];
  let activeTab = null;

  function sendTabMessage(message) {
    return new Promise((resolve, reject) => {
      if (!activeTab?.id) return reject(new Error('当前没有活动标签页。'));
      chrome.tabs.sendMessage(activeTab.id, message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve(response);
      });
    });
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve(response);
      });
    });
  }

  async function saveSettings() {
    await chrome.storage.local.set({ settings });
  }

  function renderSettings() {
    elements.enabled.checked = settings.enabled;
    elements.showOriginal.checked = settings.showOriginal;
    elements.auditEnabled.checked = settings.auditEnabled;
    elements.showOriginal.disabled = !settings.enabled;
  }

  function renderAuditTotal() {
    elements.auditTotal.textContent = String(auditEntries.length);
    elements.exportAudit.disabled = auditEntries.length === 0;
    elements.clearAudit.disabled = auditEntries.length === 0;
  }

  async function refreshStatus() {
    if (!activeTab?.url?.startsWith('https://github.com/')) {
      elements.pageStatus.textContent = '请打开 github.com 页面';
      elements.translatedCount.textContent = '—';
      elements.unknownCount.textContent = '—';
      elements.rescan.disabled = true;
      return;
    }
    try {
      const status = await sendTabMessage({ type: 'content:getStatus' });
      elements.pageStatus.textContent = status?.pageType || 'GitHub 页面';
      elements.translatedCount.textContent = String(status?.translatedCount ?? 0);
      elements.unknownCount.textContent = String(status?.unknownCount ?? 0);
      elements.rescan.disabled = false;
    } catch {
      elements.pageStatus.textContent = '刷新页面后即可启用';
      elements.rescan.disabled = true;
    }
  }

  function renderSource() {
    const meta = globalThis.GITHUB_ZH_DICTIONARY?.meta;
    elements.sourceVersion.textContent = meta?.upstreamSha ? meta.upstreamSha.slice(0, 8) : '未知';
    if (!meta?.generatedAt) {
      elements.sourceDate.textContent = '未知';
      return;
    }
    elements.sourceDate.textContent = new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    }).format(new Date(meta.generatedAt));
  }

  function bindToggle(element, key) {
    element.addEventListener('change', async () => {
      settings = { ...settings, [key]: element.checked };
      renderSettings();
      await saveSettings();
      window.setTimeout(refreshStatus, 120);
    });
  }

  bindToggle(elements.enabled, 'enabled');
  bindToggle(elements.showOriginal, 'showOriginal');
  bindToggle(elements.auditEnabled, 'auditEnabled');

  elements.rescan.addEventListener('click', async () => {
    elements.rescan.disabled = true;
    try {
      await sendTabMessage({ type: 'content:rescan' });
      window.setTimeout(refreshStatus, 220);
    } finally {
      window.setTimeout(() => { elements.rescan.disabled = false; }, 300);
    }
  });

  elements.exportAudit.addEventListener('click', () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      source: globalThis.GITHUB_ZH_DICTIONARY?.meta ?? null,
      entries: auditEntries
    };
    const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `github-zh-ui-audit-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  elements.clearAudit.addEventListener('click', async () => {
    await sendRuntimeMessage({ type: 'audit:clear' });
    auditEntries = [];
    renderAuditTotal();
  });

  async function initialize() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTab = tab ?? null;
    const stored = await chrome.storage.local.get(['settings', 'auditEntries']);
    settings = { ...DEFAULT_SETTINGS, ...stored.settings };
    auditEntries = Array.isArray(stored.auditEntries) ? stored.auditEntries : [];
    renderSettings();
    renderAuditTotal();
    renderSource();
    await refreshStatus();
  }

  void initialize();
})();
