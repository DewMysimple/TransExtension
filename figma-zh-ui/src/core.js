(function initFigmaZhCore(root, factory) {
  const api = factory();
  root.FigmaZhCore = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createFigmaZhCore() {
  'use strict';

  function classifyPage(pathname) {
    const path = String(pathname || '/').toLowerCase();
    if (path === '/' || path.startsWith('/files/')) return 'files';
    if (/^\/(design|board|slides|make|proto|file)\//.test(path)) return 'editor';
    if (path.startsWith('/community')) return 'community';
    if (path.startsWith('/settings') || path.startsWith('/account')) return 'settings';
    if (path.startsWith('/admin') || path.startsWith('/organization')) return 'admin';
    if (path.startsWith('/plugin-docs') || path.startsWith('/developers')) return 'developer';
    return 'public';
  }

  function splitWhitespace(value) {
    const match = String(value).match(/^(\s*)([\s\S]*?)(\s*)$/);
    return { before: match?.[1] ?? '', core: match?.[2] ?? String(value), after: match?.[3] ?? '' };
  }

  function compilePattern(pattern) {
    try {
      if (typeof pattern?.source !== 'string' || typeof pattern.replacement !== 'string') return null;
      return { expression: new RegExp(pattern.source, pattern.flags || ''), replacement: pattern.replacement };
    } catch {
      return null;
    }
  }

  function matchPattern(text, pattern) {
    pattern.expression.lastIndex = 0;
    const match = pattern.expression.exec(text);
    if (!match || match[0] !== text) return null;
    // Generated templates contain disjoint captures for names/counts. More literal
    // text is more specific, so "Access options for {1} members" beats "{1} members".
    const specificity = text.length - match.slice(1).reduce((length, value) => length + (value?.length || 0), 0);
    let nextCapture = 1;
    const value = /\{[1-9]\d*\}/.test(pattern.replacement)
      ? pattern.replacement.replace(/\{([1-9]\d*)\}/g, (placeholder, index) => match[Number(index)] ?? placeholder)
      : pattern.replacement.replace(/\{@\}/g, (placeholder) => match[nextCapture++] ?? placeholder);
    // A callback and a single pass preserve literal $& and {2} inside captured names.
    return { value, specificity };
  }

  function applyPattern(text, pattern) {
    const compiled = compilePattern(pattern);
    return compiled ? matchPattern(text, compiled)?.value ?? null : null;
  }

  function normalizeUiWhitespace(value) {
    return value.trim().replace(/\s+/g, ' ');
  }

  function normalizedEntries(entries) {
    const normalized = new Map();
    for (const [source, translation] of Object.entries(entries)) {
      if (typeof translation !== 'string') continue;
      const key = normalizeUiWhitespace(source);
      const value = translation.trim();
      if (!normalized.has(key)) normalized.set(key, value);
      else if (normalized.get(key) !== value) normalized.set(key, null);
    }
    return normalized;
  }

  function createTranslator({ dictionary, overrides = {}, pathname = '/' }) {
    if (!dictionary?.exact || !Array.isArray(dictionary?.patterns)) throw new Error('Invalid Figma translation dictionary.');
    const pageType = classifyPage(pathname);
    const routeOverrides = overrides.routes?.[pageType] ?? {};
    const exactLayers = [routeOverrides, overrides.exact ?? {}, dictionary.exact];
    const normalizedLayers = exactLayers.map(normalizedEntries);
    const patterns = dictionary.patterns.map(compilePattern).filter(Boolean);

    function exact(value, core) {
      const key = normalizeUiWhitespace(core);
      for (let index = 0; index < exactLayers.length; index += 1) {
        const entries = exactLayers[index];
        if (Object.hasOwn(entries, value) && typeof entries[value] === 'string') return entries[value];
        if (Object.hasOwn(entries, core) && typeof entries[core] === 'string') return entries[core];
        const normalized = normalizedLayers[index];
        // null means conflicting translations: never fall through to a lower
        // priority layer or a pattern. undefined means there is no known entry.
        if (normalized.has(key)) return normalized.get(key);
      }
      return undefined;
    }

    function translate(value, options = {}) {
      if (typeof value !== 'string' || !value.trim()) return { matched: false, value };

      const { before, core, after } = splitWhitespace(value);
      const translated = exact(value, core);
      if (translated === null) return { matched: false, value };
      if (translated !== undefined) {
        const result = `${before}${translated.trim()}${after}`;
        return { matched: result !== value, known: true, value: result, original: value, matchType: 'exact' };
      }

      if (options.allowPatterns !== false && value.length <= 500) {
        let best = null;
        for (const pattern of patterns) {
          const result = matchPattern(core, pattern) ?? (core !== value ? matchPattern(value, pattern) : null);
          if (result && (!best || result.specificity > best.specificity)) best = result;
        }
        if (best) {
          const result = `${before}${best.value.trim()}${after}`;
          return { matched: result !== value, known: true, value: result, original: value, matchType: 'pattern' };
        }
      }
      return { matched: false, value };
    }

    return Object.freeze({ pageType, translate });
  }

  function looksLikeEnglishUi(value) {
    const text = String(value ?? '').trim().replace(/\s+/g, ' ');
    if (text.length < 2 || text.length > 180) return false;
    if (!/[A-Za-z]/.test(text) || /[\u3400-\u9fff]/.test(text)) return false;
    if (/^(https?:|mailto:|www\.)/i.test(text)) return false;
    if (/^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$/.test(text)) return false;
    if (/^[a-f0-9]{16,}$/i.test(text) || /^\d{8,}$/.test(text)) return false;
    if (/[{}\[\]<>]|=>|::|\$\{|\b(const|let|var|function|class)\b/.test(text)) return false;
    if (/^[\w.-]+\.(js|jsx|ts|tsx|json|svg|png|jpg|css|html|fig)$/i.test(text)) return false;
    return true;
  }

  return Object.freeze({ classifyPage, createTranslator, looksLikeEnglishUi, splitWhitespace, applyPattern });
});
