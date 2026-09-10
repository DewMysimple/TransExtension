import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const generatedDir = path.join(rootDir, 'generated');
const repo = 'Figma-Cool/figmaCN';
const userAgent = 'figma-zh-ui-source-updater/0.1';

async function fetchChecked(url, accept = 'application/vnd.github+json') {
  const response = await fetch(url, { headers: { Accept: accept, 'User-Agent': userAgent } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response;
}

function compilePattern(source, replacement) {
  const placeholder = '\u0000FIGMA_ZH_CAPTURE\u0000';
  const escaped = source
    .replaceAll('{@}', placeholder)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replaceAll(placeholder, '(.+)');
  return { source: `^${escaped}$`, flags: '', replacement };
}

function normalizePairs(pairs) {
  const exact = {};
  const patterns = [];
  const conflicts = [];
  for (const item of pairs) {
    if (!Array.isArray(item) || typeof item[0] !== 'string' || typeof item[1] !== 'string') continue;
    const [english, chinese] = item;
    if (!english || !chinese) continue;
    if (english.includes('{@}')) {
      patterns.push(compilePattern(english, chinese));
      continue;
    }
    if (Object.hasOwn(exact, english) && exact[english] !== chinese) {
      conflicts.push({ english, kept: exact[english], ignored: chinese });
      continue;
    }
    if (!Object.hasOwn(exact, english)) exact[english] = chinese;
  }
  return { exact, patterns, conflicts };
}

await fs.mkdir(generatedDir, { recursive: true });
const repository = await (await fetchChecked(`https://api.github.com/repos/${repo}`)).json();
const commit = await (await fetchChecked(`https://api.github.com/repos/${repo}/commits/${repository.default_branch}`)).json();
const sha = commit.sha;
const rawBase = `https://raw.githubusercontent.com/${repo}/${sha}`;
const pairs = await (await fetchChecked(`${rawBase}/src/js/translations.json`, 'application/json')).json();
const license = await (await fetchChecked(`${rawBase}/LICENSE`, 'text/plain')).text();
const normalized = normalizePairs(pairs);
const generatedAt = new Date().toISOString();

const sources = {
  generatedAt,
  upstream: {
    repo,
    branch: repository.default_branch,
    sha,
    committedAt: commit.commit.committer.date,
    commitUrl: commit.html_url,
    license: repository.license?.spdx_id ?? 'GPL-3.0'
  },
  officialReferences: [
    'https://help.figma.com/hc/en-us/articles/14381406380183-Guide-to-the-file-browser',
    'https://help.figma.com/hc/en-us/articles/15297425105303-Explore-design-files',
    'https://help.figma.com/hc/en-us/articles/360039831974-Explore-the-navigation-bar-and-left-sidebar'
  ],
  runtimeNetworkRequests: false
};
const dictionary = {
  meta: { generatedAt, upstreamSha: sha, license: 'GPL-3.0-only' },
  exact: normalized.exact,
  patterns: normalized.patterns
};

await fs.writeFile(
  path.join(generatedDir, 'dictionary.js'),
  `/* Generated from ${repo}@${sha}. Do not edit. */\nglobalThis.FIGMA_ZH_DICTIONARY = ${JSON.stringify(dictionary)};\n`,
  'utf8'
);
await fs.writeFile(path.join(generatedDir, 'sources.json'), `${JSON.stringify(sources, null, 2)}\n`, 'utf8');
await fs.writeFile(path.join(generatedDir, 'update-report.json'), `${JSON.stringify({
  generatedAt,
  inputPairs: pairs.length,
  exactEntries: Object.keys(normalized.exact).length,
  patternEntries: normalized.patterns.length,
  conflicts: normalized.conflicts
}, null, 2)}\n`, 'utf8');
await fs.writeFile(path.join(rootDir, 'LICENSE'), license, 'utf8');

console.log(JSON.stringify({
  generatedAt,
  sha,
  committedAt: commit.commit.committer.date,
  exactEntries: Object.keys(normalized.exact).length,
  patternEntries: normalized.patterns.length,
  conflicts: normalized.conflicts.length
}, null, 2));
