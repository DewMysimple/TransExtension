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
  const TEXT_ATTRIBUTES = ['data-label', 'placeholder', 'data-placeholder', 'aria-label', 'data-tooltip'];
  const HARD_EXCLUDED_SELECTOR = [
    'script', 'style', 'noscript', 'canvas', 'svg', 'pre', 'code', 'kbd', 'samp',
    'textarea', '[contenteditable="true"]', '[role="textbox"]', '[translate="no"]',
    '[role="treeitem"]',
    '[data-figma-zh-ui]',
    'a[href*="/design/"]', 'a[href*="/board/"]', 'a[href*="/slides/"]',
    'a[href*="/make/"]', 'a[href*="/proto/"]', 'a[href*="/file/"]',
    '[data-testid*="file-name" i]', '[data-testid*="filename" i]',
    '[data-testid*="project-name" i]', '[data-testid*="team-name" i]',
    '[data-testid*="layer-name" i]', '[data-testid*="canvas" i]',
    '[data-testid*="comment-body" i]', '[data-testid*="comment-text" i]',
    '[data-testid*="user-name" i]'
  ].join(',');
  const USER_CLASS_PATTERN = /(?:^|[_-])(layer[_-]?(?:name|row|label)|file[_-]?(?:name|title|tile)|project[_-]?(?:name|title)|team[_-]?name|comment[_-]?(?:body|text|content)|user[_-]?name|title[_-]?input)(?:$|[_-])/i;
  const AUDIT_CONTROL_SELECTOR = [
    'button', '[role="button"]', '[role="menuitem"]', '[role="menuitemradio"]',
    '[role="option"]', '[role="tab"]', '[role="switch"]', 'label', 'summary',
    'i18n-text', '[data-label]', '[data-tooltip]', '[aria-label]'
  ].join(',');
  const AUDIT_CONTEXT_SELECTOR = '[role="dialog"],[role="menu"],[data-testid*="settings" i]';

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

  function hasProtectedClass(element) {
    for (let current = element; current && current !== document.documentElement; current = current.parentElement) {
      const className = typeof current.className === 'string' ? current.className : '';
      if (USER_CLASS_PATTERN.test(className)) return true;
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
  }

  function isAuditable(element, text) {
    if (!settings.auditEnabled || isProtected(element) || !core.looksLikeEnglishUi(text)) return false;
    const semanticControl = element.closest('[data-label],[data-tooltip],[aria-label],[role="menuitem"],[role="menuitemradio"],[role="option"],[role="tab"],[role="switch"]');
    if (semanticControl && !isProtected(semanticControl)) return true;
    const button = element.closest('button,[role="button"],summary,i18n-text');
    return Boolean(button && button.closest(AUDIT_CONTEXT_SELECTOR) && !isProtected(button));
  }

  function queueAudit(text, element) {
    const clean = String(text).trim().replace(/\s+/g, ' ');
    if (!isAuditable(element, clean)) return;
    const key = `${translator.pageType}\u0000${clean}`;
    currentUnknown.add(key);
    pendingAudit.set(key, { text: clean, pageType: translator.pageType });
    const host = tooltipHost(element);
    if (host) host.dataset.figmaZhUnknown = 'true';
    if (!auditFlushTimer) auditFlushTimer = window.setTimeout(flushAudit, 1200);
  }

  function flushAudit() {
    auditFlushTimer = 0;
    if (!settings.auditEnabled || !pendingAudit.size) return;
    const entries = [...pendingAudit.values()];
    pendingAudit.clear();
    try {
      chrome.runtime.sendMessage({ type: 'audit:recordBatch', entries }, () => void chrome.runtime.lastError);
    } catch {
      // Extension reloads can invalidate the runtime while an existing page remains open.
    }
  }

  function processTextNode(node) {
    const parent = node?.parentElement;
    if (!settings.enabled || !parent || isProtected(parent)) return;
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
      addOriginal(parent, current);
    } else {
      queueAudit(current, parent);
    }
  }

  function attributeRecords(element) {
    if (!translatedAttributes.has(element)) translatedAttributes.set(element, new Map());
    return translatedAttributes.get(element);
  }

  function processAttribute(element, attribute) {
    if (!settings.enabled || isProtected(element) || !element.hasAttribute(attribute)) return;
    const current = element.getAttribute(attribute);
    if (!current || !/[A-Za-z]/.test(current) || current.length > 500) return;
    const existing = translatedAttributes.get(element);
    const previous = existing?.get(attribute);
    if (previous) {
      if (current === previous.translated) return;
      existing.delete(attribute);
    }
    const result = translator.translate(current);
    if (result.matched) {
      attributeRecords(element).set(attribute, { original: current, translated: result.value });
      element.setAttribute(attribute, result.value);
      translatedCount += 1;
      addOriginal(element, current);
    } else if (element.matches(AUDIT_CONTROL_SELECTOR)) {
      queueAudit(current, element);
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

  function restoreAll() {
    for (const [node, record] of translatedTextNodes) {
      if (node.isConnected && node.nodeValue === record.translated) node.nodeValue = record.original;
    }
    translatedTextNodes.clear();
    for (const [element, records] of translatedAttributes) {
      if (!element.isConnected) continue;
      for (const [attribute, record] of records) {
        if (element.getAttribute(attribute) === record.translated) element.setAttribute(attribute, record.original);
      }
    }
    translatedAttributes.clear();
    document.querySelectorAll('[data-figma-zh-original]').forEach((element) => delete element.dataset.figmaZhOriginal);
    document.querySelectorAll('[data-figma-zh-unknown]').forEach((element) => delete element.dataset.figmaZhUnknown);
  }

  function resetRoute() {
    restoreAll();
    translator = core.createTranslator({ dictionary, overrides, pathname: location.pathname });
    lastLocation = location.href;
    translatedCount = 0;
    currentUnknown.clear();
  }

  function performScan() {
    scanTimer = 0;
    if (location.href !== lastLocation) resetRoute();
    if (!settings.enabled) return;
    const roots = pendingRoots.size ? [...pendingRoots] : [document.body];
    pendingRoots.clear();
    for (const root of roots) processRoot(root);
  }

  function scheduleScan(root = document.body) {
    if (root) pendingRoots.add(root);
    if (!scanTimer) scanTimer = window.setTimeout(performScan, 50);
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'characterData' || mutation.type === 'attributes') scheduleScan(mutation.target);
      for (const node of mutation.addedNodes ?? []) scheduleScan(node);
    }
  });

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
    document.documentElement.dataset.figmaZhAudit = String(settings.auditEnabled);
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
      attributeFilter: [...TEXT_ATTRIBUTES, 'value']
    });
    if (document.body) scheduleScan(document.body);
    else document.addEventListener('DOMContentLoaded', () => scheduleScan(document.body), { once: true });
  }

  void start();
})();
