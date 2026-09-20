(function runGitHubZhContentScript() {
  'use strict';

  const core = globalThis.GitHubZhCore;
  const dictionary = globalThis.GITHUB_ZH_DICTIONARY;
  const overrides = globalThis.GITHUB_ZH_OFFICIAL_OVERRIDES ?? {};
  if (!core || !dictionary) {
    console.error('[GitHub 简体中文界面] 词库或核心模块未加载。');
    return;
  }

  const DEFAULT_SETTINGS = Object.freeze({ enabled: true, showOriginal: true, auditEnabled: true });
  const EXCLUDED_SELECTOR = [
    'pre', 'code', 'kbd', 'samp', 'script', 'style', 'textarea', 'title',
    '[contenteditable]:not([contenteditable="false"])', '[role="textbox"]',
    '[translate="no"]', '[data-github-zh-ui]',
    '.markdown-body', '.js-comment-body', '.comment-body', '.js-preview-body',
    '[data-testid="issue-body"]', '[data-testid="comment-body"]',
    '[data-testid="issue-title"]', '.js-issue-title', '.markdown-title',
    '[data-testid="search-result"]', '[data-testid="repository-description"]',
    '[data-testid="list-view-item-title"]', '.search-match',
    '.blob-code', '.blob-code-inner', '.react-code-text', '.diff-text-inner',
    '.react-directory-filename-column', '.react-directory-commit-message',
    '.js-navigation-open', '.js-path-segment', '.final-path',
    '[data-testid="breadcrumbs"]', '[data-testid="breadcrumbs-filename"]',
    '.commit-title', '.commit-message', '.commit-author',
    '.IssueLabel', '.Label', '[data-testid="issue-label"]', 'a[href*="/labels/"]',
    '.branch-name', '.commit-ref', '.ref-name', '[data-testid="branch-name"]',
    '[data-testid="project-title"]',
    '[itemprop="name"]', '[itemprop="author"]', '[itemprop="additionalName"]',
    '[itemprop="about"]', '[data-hovercard-type="user"]', '[data-hovercard-type="repository"]',
    '#readme', '#file-name-id', '#search-suggestions-dialog',
    '.cm-editor', '.CodeMirror', 'qbsearch-input', 'marked-text'
  ].join(',');
  const AUDIT_CONTROL_SELECTOR = [
    'button', '[role="button"]', '[role="menuitem"]', '[role="menuitemradio"]',
    '[role="tab"]', 'label', 'summary', 'option', 'tool-tip', 'nav',
    '.UnderlineNav-item', '.ActionListItem-label', '.FormControl-label'
  ].join(',');
  const AUDIT_SETTINGS_SELECTOR = 'h1,h2,h3,h4,p,.note,.FormControl-caption,.Box-title';
  const TRANSLATABLE_ATTRIBUTES = ['placeholder', 'data-confirm'];
  const PROTECTION_ATTRIBUTES = [
    'id', 'class', 'contenteditable', 'role', 'translate', 'data-testid', 'data-hovercard-type', 'itemprop', 'href', 'type'
  ];

  let settings = { ...DEFAULT_SETTINGS };
  let translator = core.createTranslator({ dictionary, overrides, pathname: location.pathname });
  let lastLocation = location.href;
  let translatedCount = 0;
  let scanTimer = 0;
  let tooltipTimer = 0;
  let titleRecord = null;
  const translatedTextNodes = new Map();
  const translatedAttributes = new Map();
  const tooltipHosts = new Set();
  const pendingRoots = new Set();
  const pendingAudit = new Map();
  const currentUnknown = new Set();

  function isExcludedElement(element) {
    return !element || element.matches?.(EXCLUDED_SELECTOR) || Boolean(element.closest?.(EXCLUDED_SELECTOR));
  }

  function tooltipHostFor(element) {
    if (!element || element === document.body || element === document.documentElement) return null;
    return element.closest('button,a,label,summary,[role="button"],[role="menuitem"],[role="tab"]') || element;
  }

  function addOriginalTooltip(element, original) {
    const host = tooltipHostFor(element);
    const clean = String(original).trim();
    if (!host || !clean) return;
    tooltipHosts.add(host);
    const previous = (host.dataset.githubZhOriginal || '').split(' · ').filter(Boolean);
    if (!previous.includes(clean) && previous.length < 3) previous.push(clean);
    host.dataset.githubZhOriginal = previous.join(' · ');
  }

  function markAuditUnknown(element) {
    const host = tooltipHostFor(element);
    if (host) host.dataset.githubZhUnknown = 'true';
  }

  function isSettingsPage() {
    return translator.pageType.startsWith('settings') ||
      translator.pageType.startsWith('repository/settings') ||
      translator.pageType.startsWith('orgs/settings');
  }

  function isAuditable(element, text) {
    if (!settings.auditEnabled || isExcludedElement(element) || !core.looksLikeEnglishUi(text)) return false;
    if (element.closest('[data-hovercard-type],a[href^="mailto:"],a[href*="/commit/"]')) return false;
    if (element.closest(AUDIT_CONTROL_SELECTOR)) return true;
    if (isSettingsPage() && element.matches(AUDIT_SETTINGS_SELECTOR)) return true;
    return isSettingsPage() && Boolean(element.closest(AUDIT_SETTINGS_SELECTOR));
  }

  function normalizeAuditText(text) {
    return String(text ?? '').trim().replace(/\s+/g, ' ');
  }

  function queueAudit(text, element, source, attribute = null) {
    const clean = normalizeAuditText(text);
    if (!isAuditable(element, clean)) return;
    const key = `${translator.pageType}\u0000${clean}`;
    currentUnknown.add(key);
    let entry = pendingAudit.get(key);
    if (!entry) {
      entry = { text: clean, pageType: translator.pageType, sources: new Map() };
      pendingAudit.set(key, entry);
    }
    if (!entry.sources.has(source)) entry.sources.set(source, new Set());
    entry.sources.get(source).add(attribute);
    markAuditUnknown(element);
    scheduleAuditFlush();
  }

  function hasCurrentAuditSource(entry) {
    for (const [source, attributes] of entry.sources) {
      if (!source.isConnected) continue;
      for (const attribute of attributes) {
        const element = attribute === null ? source.parentElement : source;
        const value = attribute === null ? source.nodeValue : element.getAttribute(attribute);
        if (normalizeAuditText(value) !== entry.text || !isAuditable(element, entry.text)) continue;
        if (attribute !== null && !element.matches(AUDIT_CONTROL_SELECTOR)) continue;
        if (attribute === 'value' && !['button', 'submit', 'reset'].includes(element.type)) continue;
        return true;
      }
    }
    return false;
  }

  let auditFlushTimer = 0;
  function scheduleAuditFlush() {
    if (auditFlushTimer || !pendingAudit.size) return;
    auditFlushTimer = window.setTimeout(flushAudit, 1200);
  }

  function flushAudit() {
    auditFlushTimer = 0;
    if (!settings.enabled || !settings.auditEnabled) {
      pendingAudit.clear();
      return;
    }
    if (!pendingAudit.size) return;
    const pageType = core.classifyPage(location.pathname, dictionary.scopes).pageType;
    const entries = [];
    for (const [key, entry] of pendingAudit) {
      if (entry.pageType === pageType && hasCurrentAuditSource(entry)) {
        entries.push({ text: entry.text, pageType: entry.pageType });
      } else {
        currentUnknown.delete(key);
      }
    }
    // DOM references live only until this flush or a setting/route/rescan reset.
    pendingAudit.clear();
    if (!entries.length) return;
    try {
      chrome.runtime.sendMessage({ type: 'audit:recordBatch', entries }, () => void chrome.runtime.lastError);
    } catch {
      // The extension may have been reloaded while this page remained open.
    }
  }

  function clearAuditState() {
    window.clearTimeout(auditFlushTimer);
    auditFlushTimer = 0;
    pendingAudit.clear();
    currentUnknown.clear();
    document.querySelectorAll('[data-github-zh-unknown]').forEach((element) => {
      delete element.dataset.githubZhUnknown;
    });
  }

  function processTextNode(node) {
    if (!settings.enabled || !node?.parentElement || isExcludedElement(node.parentElement)) return;
    const current = node.nodeValue;
    if (!current || !/[A-Za-z]/.test(current) || current.trim().length > 500) return;

    const previous = translatedTextNodes.get(node);
    if (previous) {
      if (current === previous.translated) return;
      translatedTextNodes.delete(node);
    }

    const result = translator.translate(current);
    if (result.matched) {
      translatedTextNodes.set(node, { original: current, translated: result.value });
      node.nodeValue = result.value;
      translatedCount += 1;
      addOriginalTooltip(node.parentElement, current);
    } else if (!result.known) {
      queueAudit(current, node.parentElement, node);
    }
  }

  function attributeRecordFor(element) {
    if (!translatedAttributes.has(element)) translatedAttributes.set(element, new Map());
    return translatedAttributes.get(element);
  }

  function processAttribute(element, attribute) {
    if (!settings.enabled || isExcludedElement(element) || !element.hasAttribute(attribute)) return;
    const value = element.getAttribute(attribute);
    if (!value || !/[A-Za-z]/.test(value) || value.length > 500) return;
    const existingRecords = translatedAttributes.get(element);
    const previous = existingRecords?.get(attribute);
    if (previous) {
      if (value === previous.translated) return;
      existingRecords.delete(attribute);
    }
    const result = translator.translate(value);
    if (result.matched) {
      const records = attributeRecordFor(element);
      records.set(attribute, { original: value, translated: result.value });
      element.setAttribute(attribute, result.value);
      translatedCount += 1;
      addOriginalTooltip(element, value);
    } else if (!result.known && element.matches(AUDIT_CONTROL_SELECTOR)) {
      queueAudit(value, element, element, attribute);
    }
  }

  function processElementAttributes(element) {
    if (!(element instanceof Element) || isExcludedElement(element)) return;
    for (const attribute of TRANSLATABLE_ATTRIBUTES) processAttribute(element, attribute);
    if (element instanceof HTMLInputElement && ['button', 'submit', 'reset'].includes(element.type)) {
      processAttribute(element, 'value');
    }
  }

  function processRoot(root) {
    if (!settings.enabled || !root?.isConnected) return;
    if (root.nodeType === Node.TEXT_NODE) {
      processTextNode(root);
      return;
    }
    if (!(root instanceof Element) && root !== document) return;
    if (root instanceof Element && isExcludedElement(root)) return;
    if (root instanceof Element) processElementAttributes(root);

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node.nodeType === Node.ELEMENT_NODE && isExcludedElement(node)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let node = walker.nextNode();
    while (node) {
      if (node.nodeType === Node.TEXT_NODE) processTextNode(node);
      else processElementAttributes(node);
      node = walker.nextNode();
    }
  }

  function translateDocumentTitle() {
    if (!settings.enabled || !document.title) return;
    if (titleRecord && document.title === titleRecord.translated) return;
    if (titleRecord && document.title !== titleRecord.translated) titleRecord = null;
    const result = translator.translateTitle(document.title);
    if (!result.matched) return;
    titleRecord = { original: document.title, translated: result.value };
    document.title = result.value;
  }

  function resetForRoute() {
    restoreAll();
    clearAuditState();
    hideTooltip();
    translator = core.createTranslator({ dictionary, overrides, pathname: location.pathname });
    lastLocation = location.href;
    translatedCount = 0;
    currentUnknown.clear();
    pendingRoots.clear();
    if (document.body) pendingRoots.add(document.body);
  }

  function restoreText(node, record) {
    if (node.nodeValue === record.translated) node.nodeValue = record.original;
  }

  function restoreAttributes(element, records) {
    for (const [attribute, record] of records) {
      if (element.getAttribute(attribute) === record.translated) element.setAttribute(attribute, record.original);
    }
  }

  // A framework can remove, repurpose, or move nodes into protected content.
  // Release their translation records before scanning the next DOM state.
  function reconcileTranslations() {
    for (const [node, record] of translatedTextNodes) {
      if (!node.isConnected || isExcludedElement(node.parentElement)) {
        restoreText(node, record);
        translatedTextNodes.delete(node);
      } else if (node.nodeValue !== record.translated) {
        translatedTextNodes.delete(node);
      }
    }
    for (const [element, records] of translatedAttributes) {
      if (!element.isConnected || isExcludedElement(element)) {
        restoreAttributes(element, records);
        translatedAttributes.delete(element);
      } else {
        for (const [attribute, record] of records) {
          if (attribute === 'value' && !['button', 'submit', 'reset'].includes(element.type)) {
            if (element.getAttribute(attribute) === record.translated) element.setAttribute(attribute, record.original);
            records.delete(attribute);
            continue;
          }
          if (element.getAttribute(attribute) !== record.translated) records.delete(attribute);
        }
        if (!records.size) translatedAttributes.delete(element);
      }
    }
  }

  function refreshOriginalTooltips() {
    for (const host of tooltipHosts) delete host.dataset.githubZhOriginal;
    tooltipHosts.clear();
    for (const [node, record] of translatedTextNodes) addOriginalTooltip(node.parentElement, record.original);
    for (const [element, records] of translatedAttributes) {
      for (const record of records.values()) addOriginalTooltip(element, record.original);
    }
  }

  function restoreAll() {
    for (const [node, record] of translatedTextNodes) {
      restoreText(node, record);
    }
    translatedTextNodes.clear();
    for (const [element, records] of translatedAttributes) {
      restoreAttributes(element, records);
    }
    translatedAttributes.clear();
    if (titleRecord && document.title === titleRecord.translated) document.title = titleRecord.original;
    titleRecord = null;
    for (const host of tooltipHosts) delete host.dataset.githubZhOriginal;
    tooltipHosts.clear();
    document.querySelectorAll('[data-github-zh-unknown]').forEach((element) => {
      delete element.dataset.githubZhUnknown;
    });
  }

  function performScan() {
    scanTimer = 0;
    if (location.href !== lastLocation) resetForRoute();
    if (!settings.enabled) {
      pendingRoots.clear();
      return;
    }
    reconcileTranslations();
    const roots = pendingRoots.size ? [...pendingRoots] : [document.body];
    pendingRoots.clear();
    for (const root of roots) processRoot(root);
    translateDocumentTitle();
    refreshOriginalTooltips();
  }

  function scheduleScan(root = document.body) {
    if (root) pendingRoots.add(root);
    if (!scanTimer) scanTimer = window.setTimeout(performScan, 60);
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') scheduleScan(mutation.target);
      if (mutation.type === 'attributes') scheduleScan(mutation.target);
      for (const node of mutation.addedNodes ?? []) scheduleScan(node);
      if (mutation.removedNodes?.length) scheduleScan(mutation.target);
    }
  });

  function ensureTooltip() {
    let tooltip = document.getElementById('github-zh-ui-original-tooltip');
    if (!tooltip && document.body) {
      tooltip = document.createElement('div');
      tooltip.id = 'github-zh-ui-original-tooltip';
      tooltip.dataset.githubZhUi = 'true';
      tooltip.setAttribute('role', 'tooltip');
      document.body.append(tooltip);
    }
    return tooltip;
  }

  function hideTooltip() {
    window.clearTimeout(tooltipTimer);
    const tooltip = document.getElementById('github-zh-ui-original-tooltip');
    if (tooltip) tooltip.dataset.visible = 'false';
  }

  function showTooltipFor(target) {
    if (!settings.showOriginal || !settings.enabled) return;
    const original = target?.dataset.githubZhOriginal;
    if (!original) return;
    window.clearTimeout(tooltipTimer);
    tooltipTimer = window.setTimeout(() => {
      if (!settings.enabled || !settings.showOriginal || !target.isConnected || !target.dataset.githubZhOriginal) return;
      const tooltip = ensureTooltip();
      if (!tooltip) return;
      tooltip.textContent = target.dataset.githubZhOriginal;
      tooltip.dataset.visible = 'true';
      const rect = target.getBoundingClientRect();
      const top = Math.min(window.innerHeight - tooltip.offsetHeight - 8, rect.bottom + 8);
      const left = Math.min(window.innerWidth - tooltip.offsetWidth - 8, Math.max(8, rect.left));
      tooltip.style.top = `${Math.max(8, top)}px`;
      tooltip.style.left = `${left}px`;
    }, 420);
  }

  document.addEventListener('pointerover', (event) => {
    const target = event.target instanceof Element ? event.target.closest('[data-github-zh-original]') : null;
    if (target) showTooltipFor(target);
  }, true);
  document.addEventListener('pointerout', (event) => {
    const from = event.target instanceof Element ? event.target.closest('[data-github-zh-original]') : null;
    const to = event.relatedTarget instanceof Element ? event.relatedTarget.closest('[data-github-zh-original]') : null;
    if (from !== to) hideTooltip();
  }, true);

  document.addEventListener('turbo:before-render', () => restoreAll(), true);
  document.addEventListener('turbo:render', () => scheduleScan(document.body), true);
  document.addEventListener('turbo:load', () => scheduleScan(document.body), true);
  window.addEventListener('popstate', () => scheduleScan(document.body));
  window.addEventListener('hashchange', () => scheduleScan(document.body));
  // History changes need not emit Turbo or DOM events in an isolated script.
  window.setInterval(() => {
    if (location.href !== lastLocation) scheduleScan(document.body);
  }, 500);

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes.settings) return;
    const wasEnabled = settings.enabled;
    settings = { ...DEFAULT_SETTINGS, ...changes.settings.newValue };
    document.documentElement.dataset.githubZhAudit = String(settings.auditEnabled);
    if (!settings.enabled || !settings.auditEnabled) clearAuditState();
    if (!settings.enabled || !settings.showOriginal) hideTooltip();
    if (wasEnabled && !settings.enabled) {
      restoreAll();
      hideTooltip();
    } else if (settings.enabled) {
      scheduleScan(document.body);
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'content:getStatus') {
      sendResponse({
        enabled: settings.enabled,
        pageType: translator.pageType,
        translatedCount,
        unknownCount: currentUnknown.size,
        sourceGeneratedAt: dictionary.meta.generatedAt,
        sourceSha: dictionary.meta.upstreamSha
      });
      return false;
    }
    if (message?.type === 'content:rescan') {
      restoreAll();
      clearAuditState();
      translatedCount = 0;
      currentUnknown.clear();
      scheduleScan(document.body);
      sendResponse({ scheduled: true });
      return false;
    }
    return false;
  });

  async function start() {
    const stored = await chrome.storage.local.get('settings');
    settings = { ...DEFAULT_SETTINGS, ...stored.settings };
    document.documentElement.dataset.githubZhAudit = String(settings.auditEnabled);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...TRANSLATABLE_ATTRIBUTES, ...PROTECTION_ATTRIBUTES, 'value']
    });
    if (document.body) scheduleScan(document.body);
    else document.addEventListener('DOMContentLoaded', () => scheduleScan(document.body), { once: true });
  }

  void start();
})();
