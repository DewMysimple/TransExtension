(function runFigmaZhContentScript() {
  'use strict';

  const core = globalThis.FigmaZhCore;
  const dictionary = globalThis.FIGMA_ZH_DICTIONARY;
  const overrides = globalThis.FIGMA_ZH_OFFICIAL_OVERRIDES ?? {};
  if (!core || !dictionary) {
    console.error('[Figma 简体中文界面] 核心模块或词库未加载。');
    return;
  }

  const DEFAULT_SETTINGS = Object.freeze({ enabled: true, showOriginal: true, auditEnabled: true });
  const TEXT_ATTRIBUTES = ['title', 'data-label', 'placeholder', 'data-placeholder', 'aria-label', 'data-tooltip'];
  const HARD_EXCLUDED_SELECTOR = [
    'script', 'style', 'noscript', 'canvas', 'svg', 'pre', 'code', 'kbd', 'samp',
    'textarea', '[contenteditable]:not([contenteditable="false"])', '[role="textbox"]',
    '[role="treeitem"]',
    '[data-figma-zh-ui]',
    'a[href*="/design/"]', 'a[href*="/board/"]', 'a[href*="/slides/"]',
    'a[href*="/make/"]', 'a[href*="/proto/"]', 'a[href*="/file/"]',
    '[data-testid*="file-name" i]', '[data-testid*="filename" i]',
    '[data-testid*="project-name" i]', '[data-testid*="team-name" i]',
    '[data-testid*="folder-name" i]', '[data-testid*="folder-title" i]', '[data-testid*="workspace-name" i]',
    '[data-testid*="layer-name" i]', '[data-testid*="canvas" i]',
    '[data-testid*="variable-name" i]',
    '[data-testid*="comment-body" i]', '[data-testid*="comment-text" i]',
    '[data-testid*="user-name" i]'
  ].join(',');
  const USER_CLASS_PATTERN = /(?:^|[\s_-])(layer[_-]?(?:name|row|label)|file[_-]?(?:name|title|tile)|(?:project|folder)[_-]?(?:name|title)|(?:team|workspace)[_-]?name|variable[_-]?name|comment[_-]?(?:body|text|content)|user[_-]?name|title[_-]?input)(?:$|[\s_-])/i;
  const AUDIT_CONTROL_SELECTOR = [
    'button', '[role="button"]', '[role="menuitem"]', '[role="menuitemradio"]',
    '[role="option"]', '[role="tab"]', '[role="switch"]', 'label', 'summary',
    'i18n-text', '[data-label]', '[data-tooltip]', '[aria-label]'
  ].join(',');
  const AUDIT_CONTEXT_SELECTOR = '[role="dialog"],[role="menu"],[data-testid*="settings" i]';
  // Figma marks ordinary panels translate=no as well. Only explicit fixed UI
  // semantics may opt back in; user-content exclusions always take precedence.
  const FIXED_UI_SELECTOR = 'button,[role="button"],[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"],[role="tab"],[role="switch"],[role="tooltip"],i18n-text';

  let settings = { ...DEFAULT_SETTINGS };
  let translator = core.createTranslator({ dictionary, overrides, pathname: location.pathname });
  let lastLocation = location.href;
  let translatedCount = 0;
  let scanTimer = 0;
  let auditFlushTimer = 0;
  let tooltipTimer = 0;
  const translatedTextNodes = new Map();
  const translatedAttributes = new Map();
  const pendingRoots = new Set();
  const pendingAudit = new Map();
  const currentUnknown = new Set();
  const markedHosts = new Set();
  const compositeRecords = new Map();

  function hasProtectedClass(element) {
    for (let current = element; current && current !== document.documentElement; current = current.parentElement) {
      const className = typeof current.className === 'string' ? current.className : '';
      if (USER_CLASS_PATTERN.test(className)) return true;
      // The file-browser shell itself is draggable; its nested file items still
      // keep their own drag/name protections. Do not exempt other drag targets.
      if (current.getAttribute('draggable') === 'true'
        && ![...current.classList].some((name) => name.startsWith('file_browser--canvas--'))) return true;
    }
    return false;
  }

  function isProtected(element) {
    if (!element) return true;
    if (element.matches?.(HARD_EXCLUDED_SELECTOR) || element.closest?.(HARD_EXCLUDED_SELECTOR)) return true;
    if (hasProtectedClass(element)) return true;
    const input = element.closest?.('input');
    if (input && !['button', 'submit', 'reset'].includes(input.type)) return true;
    return false;
  }

  function canTranslate(element) {
    if (isProtected(element)) return false;
    return !element.closest('[translate="no"]') || Boolean(element.closest(FIXED_UI_SELECTOR));
  }

  function tooltipHost(element) {
    if (!element || element === document.body || element === document.documentElement) return null;
    return element.closest('button,a,label,summary,[role="button"],[role="menuitem"],[role="option"],[role="tab"]') || element;
  }

  function addOriginal(element, original) {
    const host = tooltipHost(element);
    const clean = String(original).trim().replace(/\s+/g, ' ');
    if (!host || !clean) return;
    const values = (host.dataset.figmaZhOriginal || '').split(' · ').filter(Boolean);
    if (!values.includes(clean) && values.length < 3) values.push(clean);
    host.dataset.figmaZhOriginal = values.join(' · ');
    markedHosts.add(host);
  }

  function isAuditable(element, text) {
    if (!settings.auditEnabled || !canTranslate(element) || !core.looksLikeEnglishUi(text)) return false;
    const semanticControl = element.closest('[data-label],[data-tooltip],[aria-label],[role="menuitem"],[role="menuitemradio"],[role="option"],[role="tab"],[role="switch"]');
    if (semanticControl && !isProtected(semanticControl)) return true;
    const button = element.closest('button,[role="button"],summary,i18n-text');
    return Boolean(button && button.closest(AUDIT_CONTEXT_SELECTOR) && !isProtected(button));
  }

  function queueAudit(text, element, source) {
    const clean = String(text).trim().replace(/\s+/g, ' ');
    if (!isAuditable(element, clean)) return;
    const key = `${translator.pageType}\u0000${clean}`;
    currentUnknown.add(key);
    const entry = pendingAudit.get(key) ?? { text: clean, pageType: translator.pageType, sources: [] };
    if (!entry.sources.some((item) => item.element === element && item.node === source.node && item.attribute === source.attribute)) {
      entry.sources.push({ element, ...source });
    }
    pendingAudit.set(key, entry);
    const host = tooltipHost(element);
    if (host) {
      host.dataset.figmaZhUnknown = 'true';
      markedHosts.add(host);
    }
    if (!auditFlushTimer) auditFlushTimer = window.setTimeout(flushAudit, 1200);
  }

  function flushAudit() {
    auditFlushTimer = 0;
    if (!settings.enabled || !settings.auditEnabled || !pendingAudit.size) return;
    const entries = [];
    for (const [key, entry] of pendingAudit) {
      const valid = entry.pageType === translator.pageType && location.href === lastLocation && entry.sources.some((source) => {
        const element = source.node?.parentElement ?? source.element;
        const value = source.node ? source.node.nodeValue : element.getAttribute(source.attribute);
        return element?.isConnected && isAuditable(element, entry.text)
          && String(value ?? '').trim().replace(/\s+/g, ' ') === entry.text;
      });
      if (valid) entries.push({ text: entry.text, pageType: entry.pageType });
      else {
        currentUnknown.delete(key);
        for (const source of entry.sources) {
          const host = tooltipHost(source.element);
          if (host) delete host.dataset.figmaZhUnknown;
        }
      }
    }
    pendingAudit.clear();
    if (!entries.length) return;
    try {
      chrome.runtime.sendMessage({ type: 'audit:recordBatch', entries }, () => void chrome.runtime.lastError);
    } catch {
      // Extension reloads can invalidate the runtime while an existing page remains open.
    }
  }

  function processTextNode(node) {
    const parent = node?.parentElement;
    if (!settings.enabled || !parent || !canTranslate(parent)) return;
    const composite = parent.closest('i18n-text');
    if (composite && processComposite(composite)) return;
    const current = node.nodeValue;
    const previous = translatedTextNodes.get(node);
    if (previous) {
      if (current === previous.translated) return;
      translatedTextNodes.delete(node);
    }
    if (!current || !/[A-Za-z]/.test(current) || current.trim().length > 500) return;
    const result = translator.translate(current);
    if (result.matched) {
      translatedTextNodes.set(node, { original: current, translated: result.value });
      node.nodeValue = result.value;
      translatedCount += 1;
      addOriginal(parent, current);
    } else if (!result.known) {
      queueAudit(current, parent, { node });
    }
  }

  // Translate a known i18n label across formatting nodes without replacing DOM
  // elements, event listeners, or user-supplied placeholders. Every leaf keeps
  // its own restoration record, including leaves temporarily rendered empty.
  function processComposite(element) {
    if (!canTranslate(element)) return false;
    const previous = compositeRecords.get(element);
    if (previous) {
      if (previous.every(({ node, translated }) => element.contains(node) && node.nodeValue === translated)
        && element.textContent === previous.map(({ translated }) => translated).join('')) return true;
      for (const record of previous) {
        if (record.node.nodeValue === record.translated) record.node.nodeValue = record.original;
        translatedTextNodes.delete(record.node);
      }
      compositeRecords.delete(element);
    }
    if (!isPlainLabel(element)) return false;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    if (nodes.length < 2) return false;
    const original = element.textContent;
    const result = translator.translate(original, { allowPatterns: false });
    if (!result.matched) return false;
    const records = nodes.map((node, index) => ({ node, original: node.nodeValue, translated: index === 0 ? result.value : '' }));
    compositeRecords.set(element, records);
    for (const record of records) {
      translatedTextNodes.set(record.node, record);
      record.node.nodeValue = record.translated;
    }
    translatedCount += 1;
    addOriginal(element, original);
    return true;
  }

  function isPlainLabel(element) {
    return ![...element.querySelectorAll('*')].some((child) =>
      child.tagName !== 'SPAN' || !canTranslate(child) || child.attributes.length > 0);
  }

  function attributeRecords(element) {
    if (!translatedAttributes.has(element)) translatedAttributes.set(element, new Map());
    return translatedAttributes.get(element);
  }

  function processAttribute(element, attribute) {
    if (!settings.enabled || !canTranslate(element) || !element.hasAttribute(attribute)) return;
    const current = element.getAttribute(attribute);
    const existing = translatedAttributes.get(element);
    const previous = existing?.get(attribute);
    if (previous) {
      if (current === previous.translated) return;
      existing.delete(attribute);
    }
    if (!current || !/[A-Za-z]/.test(current) || current.length > 500) return;
    const result = translator.translate(current);
    if (result.matched) {
      attributeRecords(element).set(attribute, { original: current, translated: result.value });
      element.setAttribute(attribute, result.value);
      translatedCount += 1;
      addOriginal(element, current);
    } else if (!result.known && element.matches(AUDIT_CONTROL_SELECTOR)) {
      queueAudit(current, element, { attribute });
    }
  }

  function processElement(element) {
    if (!(element instanceof Element) || isProtected(element)) return;
    for (const attribute of TEXT_ATTRIBUTES) processAttribute(element, attribute);
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
    if (root instanceof Element && isProtected(root)) return;
    if (root instanceof Element) processElement(root);

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node.nodeType === Node.ELEMENT_NODE && isProtected(node)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let node = walker.nextNode();
    while (node) {
      if (node.nodeType === Node.TEXT_NODE) processTextNode(node);
      else processElement(node);
      node = walker.nextNode();
    }
  }

  function clearMarkers(host) {
    delete host.dataset.figmaZhOriginal;
    delete host.dataset.figmaZhUnknown;
    markedHosts.delete(host);
  }

  // Restore removed nodes before releasing references: SPA views may reuse them later.
  function releaseInvalidRecords() {
    for (const [element, records] of compositeRecords) {
      if (!element.isConnected || !canTranslate(element) || !isPlainLabel(element)
        || records.some(({ node, translated }) => !element.contains(node) || node.nodeValue !== translated)) {
        for (const record of records) {
          if (record.node.nodeValue === record.translated) record.node.nodeValue = record.original;
          translatedTextNodes.delete(record.node);
        }
        compositeRecords.delete(element);
      }
    }
    for (const [node, record] of translatedTextNodes) {
      if (node.isConnected && canTranslate(node.parentElement)) {
        if (node.nodeValue !== record.translated) translatedTextNodes.delete(node);
        continue;
      }
      if (node.nodeValue === record.translated) node.nodeValue = record.original;
      translatedTextNodes.delete(node);
    }
    for (const [element, records] of translatedAttributes) {
      if (element.isConnected && canTranslate(element)) {
        for (const [attribute, record] of records) {
          if (element.getAttribute(attribute) !== record.translated) records.delete(attribute);
        }
        if (!records.size) translatedAttributes.delete(element);
        continue;
      }
      for (const [attribute, record] of records) {
        if (element.getAttribute(attribute) === record.translated) element.setAttribute(attribute, record.original);
      }
      translatedAttributes.delete(element);
    }
    for (const host of markedHosts) if (!host.isConnected || !canTranslate(host)) clearMarkers(host);
    for (const host of markedHosts) delete host.dataset.figmaZhOriginal;
    const groupedNodes = new Set();
    for (const [element, records] of compositeRecords) {
      for (const { node } of records) groupedNodes.add(node);
      addOriginal(element, records.map(({ original }) => original).join(''));
    }
    for (const [node, record] of translatedTextNodes) {
      if (!groupedNodes.has(node)) addOriginal(node.parentElement, record.original);
    }
    for (const [element, records] of translatedAttributes) {
      for (const record of records.values()) addOriginal(element, record.original);
    }
    for (const host of markedHosts) {
      if (!host.hasAttribute('data-figma-zh-original') && !host.hasAttribute('data-figma-zh-unknown')) markedHosts.delete(host);
    }
  }

  function clearPendingAudit() {
    window.clearTimeout(auditFlushTimer);
    auditFlushTimer = 0;
    pendingAudit.clear();
    currentUnknown.clear();
    for (const host of markedHosts) delete host.dataset.figmaZhUnknown;
  }

  function restoreAll() {
    compositeRecords.clear();
    for (const [node, record] of translatedTextNodes) {
      if (node.nodeValue === record.translated) node.nodeValue = record.original;
    }
    translatedTextNodes.clear();
    for (const [element, records] of translatedAttributes) {
      for (const [attribute, record] of records) {
        if (element.getAttribute(attribute) === record.translated) element.setAttribute(attribute, record.original);
      }
    }
    translatedAttributes.clear();
    for (const host of markedHosts) clearMarkers(host);
  }

  function resetRoute() {
    restoreAll();
    clearPendingAudit();
    hideTooltip();
    translator = core.createTranslator({ dictionary, overrides, pathname: location.pathname });
    lastLocation = location.href;
    translatedCount = 0;
    currentUnknown.clear();
  }

  function performScan() {
    scanTimer = 0;
    releaseInvalidRecords();
    if (location.href !== lastLocation) {
      resetRoute();
      pendingRoots.clear();
      if (document.body) pendingRoots.add(document.body);
    }
    if (!settings.enabled) {
      pendingRoots.clear();
      return;
    }
    const roots = pendingRoots.size ? [...pendingRoots] : [document.body];
    pendingRoots.clear();
    // A parent scan already covers its pending descendants.
    for (const root of roots) {
      if (!roots.some((other) => other !== root && other.contains?.(root))) processRoot(root);
    }
  }

  function scheduleScan(root = document.body) {
    if (root) pendingRoots.add(root);
    if (!scanTimer) scanTimer = window.setTimeout(performScan, 50);
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'characterData' || mutation.type === 'attributes') scheduleScan(mutation.target);
      for (const node of mutation.addedNodes ?? []) scheduleScan(node);
      if (mutation.removedNodes?.length) scheduleScan(mutation.target);
    }
  });

  window.addEventListener('popstate', () => scheduleScan(document.body));
  window.addEventListener('hashchange', () => scheduleScan(document.body));
  // pushState does not emit popstate, and isolated content scripts cannot patch
  // the application's history object. Only rescan when the location changes.
  window.setInterval(() => {
    if (location.href !== lastLocation) scheduleScan(document.body);
  }, 500);

  function ensureTooltip() {
    let tooltip = document.getElementById('figma-zh-ui-original-tooltip');
    if (!tooltip && document.body) {
      tooltip = document.createElement('div');
      tooltip.id = 'figma-zh-ui-original-tooltip';
      tooltip.dataset.figmaZhUi = 'true';
      tooltip.setAttribute('role', 'tooltip');
      document.body.append(tooltip);
    }
    return tooltip;
  }

  function hideTooltip() {
    window.clearTimeout(tooltipTimer);
    const tooltip = document.getElementById('figma-zh-ui-original-tooltip');
    if (tooltip) tooltip.dataset.visible = 'false';
  }

  function showTooltip(target) {
    if (!settings.enabled || !settings.showOriginal || !target?.dataset.figmaZhOriginal) return;
    window.clearTimeout(tooltipTimer);
    tooltipTimer = window.setTimeout(() => {
      if (!settings.enabled || !settings.showOriginal || !target.isConnected || !target.dataset.figmaZhOriginal) return;
      const tooltip = ensureTooltip();
      if (!tooltip || !target.isConnected) return;
      tooltip.textContent = target.dataset.figmaZhOriginal;
      tooltip.dataset.visible = 'true';
      const rect = target.getBoundingClientRect();
      const top = Math.min(window.innerHeight - tooltip.offsetHeight - 8, rect.bottom + 8);
      const left = Math.min(window.innerWidth - tooltip.offsetWidth - 8, Math.max(8, rect.left));
      tooltip.style.top = `${Math.max(8, top)}px`;
      tooltip.style.left = `${left}px`;
    }, 420);
  }

  document.addEventListener('pointerover', (event) => {
    const target = event.target instanceof Element ? event.target.closest('[data-figma-zh-original]') : null;
    if (target) showTooltip(target);
  }, true);
  document.addEventListener('pointerout', (event) => {
    const from = event.target instanceof Element ? event.target.closest('[data-figma-zh-original]') : null;
    const to = event.relatedTarget instanceof Element ? event.relatedTarget.closest('[data-figma-zh-original]') : null;
    if (from !== to) hideTooltip();
  }, true);

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes.settings) return;
    const wasEnabled = settings.enabled;
    settings = { ...DEFAULT_SETTINGS, ...changes.settings.newValue };
    if (!settings.enabled || !settings.auditEnabled) clearPendingAudit();
    document.documentElement.dataset.figmaZhAudit = String(settings.auditEnabled);
    if (!settings.showOriginal) hideTooltip();
    if (wasEnabled && !settings.enabled) {
      restoreAll();
      translatedCount = 0;
      hideTooltip();
    } else if (settings.enabled) {
      scheduleScan(document.body);
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'content:getStatus') {
      sendResponse({
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
      clearPendingAudit();
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
    document.documentElement.dataset.figmaZhAudit = String(settings.auditEnabled);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...TEXT_ATTRIBUTES, 'value', 'class', 'contenteditable', 'translate', 'role', 'data-testid', 'href', 'type', 'draggable']
    });
    if (document.body) scheduleScan(document.body);
    else document.addEventListener('DOMContentLoaded', () => scheduleScan(document.body), { once: true });
  }

  void start();
})();
