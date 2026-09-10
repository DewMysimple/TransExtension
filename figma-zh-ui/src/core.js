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

  function applyPattern(text, pattern) {
    try {
      const expression = new RegExp(pattern.source, pattern.flags || '');
      const match = text.match(expression);
      if (!match) return null;
      let result = pattern.replacement;
      if (/\{[1-9]\d*\}/.test(result)) {
        for (let index = 1; index < match.length; index += 1) {
          result = result.replaceAll(`{${index}}`, match[index]);
        }
      } else {
        for (let index = 1; index < match.length; index += 1) result = result.replace('{@}', match[index]);
      }
      return result;
    } catch {
      return null;
    }
  }

  function createTranslator({ dictionary, overrides = {}, pathname = '/' }) {
    if (!dictionary?.exact || !Array.isArray(dictionary?.patterns)) throw new Error('Invalid Figma translation dictionary.');
    const pageType = classifyPage(pathname);
    const routeOverrides = overrides.routes?.[pageType] ?? {};

    function exact(text) {
      if (Object.hasOwn(routeOverrides, text)) return routeOverrides[text];
      if (Object.hasOwn(overrides.exact ?? {}, text)) return overrides.exact[text];
      if (Object.hasOwn(dictionary.exact, text)) return dictionary.exact[text];
      return null;
    }

    function translate(value, options = {}) {
      if (typeof value !== 'string' || !value.trim()) return { matched: false, value };

      let translated = exact(value);
      if (translated !== null && translated !== value) {
        return { matched: true, value: translated, original: value, matchType: 'exact' };
      }

      const { before, core, after } = splitWhitespace(value);
      translated = exact(core);
      if (translated !== null && translated !== core) {
        return { matched: true, value: `${before}${translated}${after}`, original: value, matchType: 'exact' };
      }

      if (options.allowPatterns !== false && value.length <= 500) {
        for (const pattern of dictionary.patterns) {
          const rawResult = applyPattern(value, pattern);
          if (rawResult !== null && rawResult !== value) {
            return { matched: true, value: rawResult, original: value, matchType: 'pattern' };
          }
          if (core !== value) {
            const coreResult = applyPattern(core, pattern);
            if (coreResult !== null && coreResult !== core) {
              return { matched: true, value: `${before}${coreResult}${after}`, original: value, matchType: 'pattern' };
            }
          }
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
