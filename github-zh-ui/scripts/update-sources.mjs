import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const generatedDir = path.join(rootDir, 'generated');
const userAgent = 'github-zh-ui-source-updater/0.1';

const repositories = [
  { id: 'github-chinese', repo: 'maboloshi/github-chinese' },
  { id: 'github-docs', repo: 'github/docs' },
  { id: 'primer-react', repo: 'primer/react' },
  { id: 'primer-view-components', repo: 'primer/view_components' }
];

async function fetchChecked(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'User-Agent': userAgent, Accept: 'application/vnd.github+json', ...options.headers }
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response;
}

async function repositorySnapshot(source) {
  const info = await (await fetchChecked(`https://api.github.com/repos/${source.repo}`)).json();
  const commit = await (await fetchChecked(`https://api.github.com/repos/${source.repo}/commits/${info.default_branch}`)).json();
  return {
    ...source,
    branch: info.default_branch,
    sha: commit.sha,
    committedAt: commit.commit.committer.date,
    commitUrl: commit.html_url
  };
}

function isStringMap(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function stringEntries(value) {
  if (!isStringMap(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, translation]) =>
    typeof key === 'string' && typeof translation === 'string' && key && translation
  ));
}

function serializeRegexList(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  for (const entry of value) {
    const isRegExp = entry?.[0] && Object.prototype.toString.call(entry[0]) === '[object RegExp]';
    if (!Array.isArray(entry) || !isRegExp || typeof entry[1] !== 'string') continue;
    result.push({ source: entry[0].source, flags: entry[0].flags.replaceAll('g', ''), replacement: entry[1] });
  }
  return result;
}

function extractTitleMap(scope) {
  if (!scope?.title) return {};
  if (scope.title.static) return stringEntries(scope.title.static);
  return stringEntries(scope.title);
}

function buildDictionary(i18n, sourceMeta) {
  const zh = i18n['zh-CN'];
  if (!zh || !zh.public) throw new Error('上游 locals.js 缺少 I18N["zh-CN"] 或 public 词库。');

  const scopes = {};
  const observed = new Map();
  for (const [scopeName, scope] of Object.entries(zh)) {
    if (!scope || typeof scope !== 'object') continue;
    const exact = stringEntries(scope.static);
    const regex = serializeRegexList(scope.regexp);
    const titles = extractTitleMap(scope);
    if (Object.keys(exact).length || regex.length || Object.keys(titles).length) {
      scopes[scopeName] = { exact, regex, titles };
    }
    for (const [english, chinese] of Object.entries(exact)) {
      if (!observed.has(english)) observed.set(english, new Set());
      observed.get(english).add(chinese);
    }
  }

  const consistent = {};
  for (const [english, translations] of observed) {
    if (translations.size === 1) consistent[english] = [...translations][0];
  }

  const globalNavigation = stringEntries(i18n.conf?.reactGlobalNavLabels);
  const publicScope = scopes.public ?? { exact: {}, regex: [], titles: {} };
  const titleScope = scopes.title ?? { exact: {}, regex: [], titles: {} };
  const base = {
    exact: { ...consistent, ...publicScope.exact, ...globalNavigation },
    regex: publicScope.regex,
    titles: { ...titleScope.exact, ...publicScope.titles }
  };

  // Most upstream page scopes spread the public dictionary into themselves.
  // Keep only true route-specific overrides so every page does not parse copies
  // of the same thousands of strings.
  const baseRegexKeys = new Set(base.regex.map((rule) => `${rule.source}\u0000${rule.flags}\u0000${rule.replacement}`));
  for (const scope of Object.values(scopes)) {
    scope.exact = Object.fromEntries(Object.entries(scope.exact).filter(([english, chinese]) =>
      base.exact[english] !== chinese
    ));
    scope.titles = Object.fromEntries(Object.entries(scope.titles).filter(([english, chinese]) =>
      base.titles[english] !== chinese
    ));
    scope.regex = scope.regex.filter((rule) =>
      !baseRegexKeys.has(`${rule.source}\u0000${rule.flags}\u0000${rule.replacement}`)
    );
  }

  return {
    meta: {
      generatedAt: sourceMeta.generatedAt,
      upstreamSha: sourceMeta.sources.find((source) => source.id === 'github-chinese').sha,
      license: 'GPL-3.0-only'
    },
    base,
    scopes
  };
}

function countDictionary(dictionary) {
  return {
    baseExact: Object.keys(dictionary.base.exact).length,
    baseRegex: dictionary.base.regex.length,
    scopes: Object.keys(dictionary.scopes).length,
    scopedExact: Object.values(dictionary.scopes).reduce((sum, scope) => sum + Object.keys(scope.exact).length, 0),
    scopedRegex: Object.values(dictionary.scopes).reduce((sum, scope) => sum + scope.regex.length, 0)
  };
}

async function readPreviousDictionary(dictionaryPath) {
  try {
    const source = await fs.readFile(dictionaryPath, 'utf8');
    const sandbox = { globalThis: {} };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox, { timeout: 10_000 });
    return sandbox.globalThis.GITHUB_ZH_DICTIONARY ?? null;
  } catch {
    return null;
  }
}

await fs.mkdir(generatedDir, { recursive: true });
const sources = [];
for (const repository of repositories) sources.push(await repositorySnapshot(repository));

const generatedAt = new Date().toISOString();
const sourceMeta = {
  generatedAt,
  sources,
  officialTerminology: [
    'https://docs.github.com/en',
    'https://docs.github.com/zh'
  ],
  runtimeNetworkRequests: false
};

const chineseSource = sources.find((source) => source.id === 'github-chinese');
const rawBase = `https://raw.githubusercontent.com/${chineseSource.repo}/${chineseSource.sha}`;
const localsSource = await (await fetchChecked(`${rawBase}/locals.js`, { headers: { Accept: 'text/plain' } })).text();
const licenseSource = await (await fetchChecked(`${rawBase}/LICENSE`, { headers: { Accept: 'text/plain' } })).text();

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(localsSource, sandbox, { timeout: 30_000, filename: 'upstream-locals.js' });
if (!sandbox.I18N) throw new Error('无法从上游 locals.js 提取 I18N。');

const dictionary = buildDictionary(sandbox.I18N, sourceMeta);
const dictionaryPath = path.join(generatedDir, 'dictionary.js');
const previous = await readPreviousDictionary(dictionaryPath);
const output = `/* Generated file. Do not edit manually. Source metadata: generated/sources.json */\n` +
  `globalThis.GITHUB_ZH_DICTIONARY = ${JSON.stringify(dictionary)};\n`;

await fs.writeFile(dictionaryPath, output, 'utf8');
await fs.writeFile(path.join(generatedDir, 'sources.json'), `${JSON.stringify(sourceMeta, null, 2)}\n`, 'utf8');
await fs.writeFile(path.join(generatedDir, 'update-report.json'), `${JSON.stringify({
  generatedAt,
  previous: previous ? countDictionary(previous) : null,
  current: countDictionary(dictionary)
}, null, 2)}\n`, 'utf8');
await fs.writeFile(path.join(rootDir, 'LICENSE'), licenseSource, 'utf8');

console.log(JSON.stringify({ generatedAt, sources, counts: countDictionary(dictionary) }, null, 2));
