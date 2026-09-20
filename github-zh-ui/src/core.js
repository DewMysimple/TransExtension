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
  const REPOSITORY_PAGES = new Set([
    'actions', 'activity', 'agents', 'attestations', 'blame', 'blob', 'branches',
    'codespaces', 'commit', 'commits', 'community', 'compare', 'contribute',
    'custom-properties', 'delete', 'deployments', 'discussions', 'edit', 'find',
    'fork', 'forks', 'graphs', 'home', 'import', 'invitations', 'issues', 'labels',
    'milestone', 'milestones', 'models', 'network', 'new', 'packages', 'pkgs',
    'projects', 'pull', 'pulls', 'pulse', 'releases', 'rules', 'runs', 'search',
    'security', 'settings', 'stargazers', 'subscription', 'tags', 'tasks',
    'transfer', 'tree', 'upload', 'watchers', 'wiki'
  ]);
  const SETTINGS_PAGES = new Set([
    'access', 'accessibility', 'actions', 'admin', 'appearance', 'applications',
    'apps', 'audit-log', 'auth', 'billing', 'blocked_users', 'branch_protection_rules',
    'branches', 'code_review_limits', 'codespaces', 'connections', 'copilot',
    'credentials', 'deleted_repositories', 'dependabot_rules', 'developers',
    'discussions', 'domains', 'education', 'emails', 'enterprises', 'environments',
    'gpg', 'hooks', 'import-export', 'installations', 'interaction_limits',
    'key_links', 'keys', 'member_privileges', 'models', 'moderators',
    'notifications', 'oauth_application_policy', 'organizations', 'packages',
    'pages', 'personal-access-token', 'personal-access-tokens', 'policies',
    'profile', 'projects', 'publisher', 'reminders', 'replies', 'repositories',
    'repository-defaults', 'roles', 'rules', 'sandboxes', 'secrets', 'security',
    'security-log', 'security_analysis', 'sessions', 'sponsors-log', 'ssh',
    'tag_protection', 'teams', 'tokens', 'variables'
  ]);
  const ORGANIZATION_PAGES = new Set([
    'dashboard', 'invitations', 'new-team', 'outside-collaborators', 'packages',
    'pending_collaborators', 'people', 'profile', 'projects', 'repositories',
    'sponsoring', 'teams', 'topics'
  ]);

  // Audit categories are fixed vocabulary, never arbitrary URL segments.
  function normalizePageType(value) {
    const parts = typeof value === 'string' ? value.split('/') : [];
    const [root, section, detail] = parts;
    if (root === 'settings') return SETTINGS_PAGES.has(section) ? `settings/${section}` : 'settings';
    if (root === 'repository' || root === 'orgs') {
      if (section === 'settings') {
        return SETTINGS_PAGES.has(detail) ? `${root}/settings/${detail}` : `${root}/settings`;
      }
      const knownPages = root === 'repository' ? REPOSITORY_PAGES : ORGANIZATION_PAGES;
      return knownPages.has(section) ? `${root}/${section}` : root;
    }
    if (root === 'profile' || root === 'public') return root;
    return RESERVED_ROOTS.has(root) ? root : 'unknown';
  }

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
      return { pageType: normalizePageType(`settings/${rest.join('/')}`), candidates };
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
          pageType: normalizePageType(`orgs/${rest.join('/')}`),
          candidates
        };
      }
      if (rest.length) addExisting(candidates, availableScopes, `orgs/${rest[0]}`);
      return { pageType: normalizePageType(rest.length ? `orgs/${rest[0]}` : 'orgs/profile'), candidates };
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
          pageType: normalizePageType(`repository/${rest.join('/')}`),
          candidates
        };
      }
      if (rest.length) {
        const route = rest[0] === 'pull' ? 'pull' : rest[0];
        addExisting(candidates, availableScopes, `repository/${route}`);
      }
      return { pageType: normalizePageType(rest.length ? `repository/${rest[0]}` : 'repository/home'), candidates };
    }

    if (segments.length === 1 && !RESERVED_ROOTS.has(segments[0])) {
      addExisting(candidates, availableScopes, 'page-profile-public', 'page-profile');
      return { pageType: 'profile', candidates };
    }

    const pageKey = segments.slice(0, 2).join('/');
    addExisting(candidates, availableScopes, pageKey, segments[0]);
    return { pageType: normalizePageType(pageKey || 'public'), candidates };
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
      if (translated === null || translated === core) return { matched: false, known: translated !== null, value };
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

  // Older releases stored dynamic route suffixes. Migrate records rather than
  // discarding the report; the popup uses the same boundary before exporting.
  function sanitizeAuditEntries(entries) {
    if (!Array.isArray(entries)) return [];
    const indexed = new Map();
    for (const entry of entries) {
      const text = typeof entry?.text === 'string' ? entry.text.trim() : '';
      if (!looksLikeEnglishUi(text)) continue;
      const count = Number(entry.count);
      const firstSeen = typeof entry.firstSeen === 'string' ? entry.firstSeen : '';
      const lastSeen = typeof entry.lastSeen === 'string' ? entry.lastSeen : '';
      if (!Number.isFinite(count) || count < 1 || !Number.isFinite(Date.parse(firstSeen)) || !Number.isFinite(Date.parse(lastSeen))) continue;
      const pageType = normalizePageType(entry.pageType);
      const key = `${pageType}\u0000${text}`;
      const current = indexed.get(key);
      if (current) {
        current.count = Math.min(current.count + Math.floor(count), 1_000_000);
        if (Date.parse(firstSeen) < Date.parse(current.firstSeen)) current.firstSeen = firstSeen;
        if (Date.parse(lastSeen) > Date.parse(current.lastSeen)) current.lastSeen = lastSeen;
      } else {
        indexed.set(key, { text, pageType, count: Math.min(Math.floor(count), 1_000_000), firstSeen, lastSeen });
      }
    }
    return [...indexed.values()].sort((a, b) => Date.parse(b.lastSeen) - Date.parse(a.lastSeen));
  }

  return Object.freeze({ classifyPage, createTranslator, looksLikeEnglishUi, normalizePageType, sanitizeAuditEntries, splitWhitespace });
});
