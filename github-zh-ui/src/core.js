(function initGitHubZhCore(root, factory) {
  const api = factory();
  root.GitHubZhCore = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createGitHubZhCore() {
  'use strict';

  const RESERVED_ROOTS = new Set([
    'account', 'apps', 'collections', 'codespaces', 'copilot', 'customer-stories',
    'dashboard', 'developer', 'discussions', 'education', 'enterprise', 'events',
    'explore', 'features', 'github-copilot', 'home', 'issues', 'login', 'logout',
    'marketplace', 'models', 'new', 'notifications', 'organizations', 'orgs',
    'password_reset', 'pricing', 'pulls', 'search', 'security', 'settings', 'signup',
    'sponsors', 'stars', 'topics', 'trending', 'users', 'watching'
  ]);

  function cleanSegments(pathname) {
    return String(pathname || '/')
      .split('/')
      .filter(Boolean)
      .map((part) => {
        try { return decodeURIComponent(part); } catch { return part; }
      });
  }

  function addExisting(candidates, availableScopes, ...names) {
    for (const name of names) {
      if (!name || candidates.includes(name)) continue;
      if (!availableScopes || Object.hasOwn(availableScopes, name)) candidates.push(name);
    }
  }

  function classifyPage(pathname, availableScopes) {
    const segments = cleanSegments(pathname);
    const candidates = [];
    addExisting(candidates, availableScopes, 'public');

    if (!segments.length || segments[0] === 'home' || segments[0] === 'dashboard') {
      addExisting(candidates, availableScopes, 'page-dashboard', 'dashboard');
      return { pageType: 'dashboard', candidates };
    }

    if (segments[0] === 'settings') {
      const rest = segments.slice(1);
      addExisting(candidates, availableScopes, 'settings-menu', 'settings');
      for (let length = 1; length <= rest.length; length += 1) {
        addExisting(candidates, availableScopes, `settings/${rest.slice(0, length).join('/')}`);
      }
      return { pageType: rest.length ? `settings/${rest.join('/')}` : 'settings', candidates };
    }

    if ((segments[0] === 'organizations' || segments[0] === 'orgs') && segments.length >= 2) {
      const rest = segments.slice(2);
      addExisting(candidates, availableScopes, 'orgs-public');
      if (rest[0] === 'settings') {
        addExisting(candidates, availableScopes, 'orgs-settings-menu', 'orgs/settings/profile');
        for (let length = 2; length <= rest.length; length += 1) {
          addExisting(candidates, availableScopes, `orgs/${rest.slice(0, length).join('/')}`);
        }
        return {
          pageType: rest.length > 1 ? `orgs/settings/${rest.slice(1).join('/')}` : 'orgs/settings',
          candidates
        };
      }
      if (rest.length) addExisting(candidates, availableScopes, `orgs/${rest[0]}`);
      return { pageType: rest.length ? `orgs/${rest[0]}` : 'orgs/profile', candidates };
    }

    const looksLikeRepository = segments.length >= 2 && !RESERVED_ROOTS.has(segments[0]);
    if (looksLikeRepository) {
      const rest = segments.slice(2);
      addExisting(candidates, availableScopes, 'repository-public', 'repository');
      if (rest[0] === 'settings') {
        addExisting(candidates, availableScopes, 'repository-settings-menu', 'repository/settings');
        for (let length = 2; length <= rest.length; length += 1) {
          addExisting(candidates, availableScopes, `repository/${rest.slice(0, length).join('/')}`);
        }
        return {
          pageType: rest.length > 1 ? `repository/settings/${rest.slice(1).join('/')}` : 'repository/settings',
          candidates
        };
      }
      if (rest.length) {
        const route = rest[0] === 'pull' ? 'pull' : rest[0];
        addExisting(candidates, availableScopes, `repository/${route}`);
      }
      return { pageType: rest.length ? `repository/${rest[0]}` : 'repository/home', candidates };
    }

    if (segments.length === 1 && !RESERVED_ROOTS.has(segments[0])) {
      addExisting(candidates, availableScopes, 'page-profile-public', 'page-profile');
      return { pageType: 'profile', candidates };
    }

    const pageKey = segments.slice(0, 2).join('/');
    addExisting(candidates, availableScopes, pageKey, segments[0]);
    return { pageType: pageKey || 'public', candidates };
  }

  function splitWhitespace(value) {
    const match = String(value).match(/^(\s*)([\s\S]*?)(\s*)$/);
    return { before: match?.[1] ?? '', core: match?.[2] ?? String(value), after: match?.[3] ?? '' };
  }

  function createTranslator({ dictionary, overrides = {}, pathname = '/' }) {
    if (!dictionary?.base || !dictionary?.scopes) throw new Error('Invalid translation dictionary.');
    const route = classifyPage(pathname, dictionary.scopes);
    const specificScopes = route.candidates
      .map((name) => dictionary.scopes[name])
      .filter(Boolean)
      .reverse();

    function exactTranslation(core) {
      if (Object.hasOwn(overrides.exact ?? {}, core)) return overrides.exact[core];
      for (const scope of specificScopes) {
        if (Object.hasOwn(scope.exact ?? {}, core)) return scope.exact[core];
      }
      if (Object.hasOwn(dictionary.base.exact ?? {}, core)) return dictionary.base.exact[core];
      return null;
    }

    function regexTranslation(core) {
      const lists = [...specificScopes.map((scope) => scope.regex ?? []), dictionary.base.regex ?? []];
      for (const list of lists) {
        for (const rule of list) {
          try {
            const expression = new RegExp(rule.source, rule.flags);
            if (!expression.test(core)) continue;
            expression.lastIndex = 0;
            const translated = core.replace(expression, rule.replacement);
            if (translated !== core) return translated;
          } catch {
            // Ignore a malformed upstream expression instead of breaking the page.
          }
        }
      }
      return null;
    }

    function translate(value, options = {}) {
      if (typeof value !== 'string' || !value.trim()) return { matched: false, value };
      const { before, core, after } = splitWhitespace(value);
      let translated = exactTranslation(core);
      let matchType = 'exact';
      if (translated === null && options.allowRegex !== false && core.length <= 500) {
        translated = regexTranslation(core);
        matchType = 'regex';
      }
      if (translated === null || translated === core) return { matched: false, value };
      return { matched: true, value: `${before}${translated}${after}`, original: value, matchType };
    }

    function translateTitle(value) {
      if (typeof value !== 'string' || !value.trim()) return { matched: false, value };
      if (Object.hasOwn(overrides.titles ?? {}, value)) {
        return { matched: true, value: overrides.titles[value], original: value, matchType: 'title' };
      }
      for (const scope of specificScopes) {
        if (Object.hasOwn(scope.titles ?? {}, value)) {
          return { matched: true, value: scope.titles[value], original: value, matchType: 'title' };
        }
      }
      if (Object.hasOwn(dictionary.base.titles ?? {}, value)) {
        return { matched: true, value: dictionary.base.titles[value], original: value, matchType: 'title' };
      }
      return translate(value);
    }

    return { ...route, translate, translateTitle };
  }

  function looksLikeEnglishUi(value) {
    const text = String(value ?? '').trim();
    if (text.length < 2 || text.length > 180) return false;
    if (!/[A-Za-z]/.test(text) || /[\u3400-\u9fff]/.test(text)) return false;
    if (/^(https?:|mailto:|git@|www\.)/i.test(text)) return false;
    if ((text.match(/[\\/]/g) ?? []).length >= 2) return false;
    if (/^[a-f0-9]{7,40}$/i.test(text) || /^[\w.-]+@[\w.-]+\.[A-Za-z]{2,}$/.test(text)) return false;
    if (/^[\w.-]+\.(js|jsx|ts|tsx|json|md|yml|yaml|toml|rs|go|py|java|css|html)$/i.test(text)) return false;
    if (/[{}\[\]<>]|=>|::|\$\{|\b(const|let|var|function|class)\b/.test(text)) return false;
    if (/^[a-z0-9_.-]+$/.test(text) && /[_\.]/.test(text)) return false;
    return true;
  }

  return Object.freeze({ classifyPage, createTranslator, looksLikeEnglishUi, splitWhitespace });
});
