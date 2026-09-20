import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const core = require('../src/core.js');
const testDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(testDir, '..');

const dictionary = {
  base: {
    exact: { Settings: '公共设置', Save: '保存' },
    regex: [{ source: '^(\\d+) issues$', flags: '', replacement: '$1 个议题' }],
    titles: { 'Account settings': '账户设置' }
  },
  scopes: {
    public: { exact: {}, regex: [], titles: {} },
    'settings-menu': { exact: {}, regex: [], titles: {} },
    'settings/profile': { exact: { Settings: '个人设置' }, regex: [], titles: {} },
    'repository-public': { exact: {}, regex: [], titles: {} },
    repository: { exact: {}, regex: [], titles: {} },
    'repository-settings-menu': { exact: {}, regex: [], titles: {} },
    'repository/settings': { exact: {}, regex: [], titles: {} },
    'repository/settings/actions': { exact: { Settings: '操作设置' }, regex: [], titles: {} },
    'orgs-public': { exact: {}, regex: [], titles: {} },
    'orgs-settings-menu': { exact: {}, regex: [], titles: {} },
    'orgs/settings/profile': { exact: {}, regex: [], titles: {} }
  }
};

test('页面分类会选择个人、仓库和组织设置词库', () => {
  assert.deepEqual(
    core.classifyPage('/settings/profile', dictionary.scopes).candidates.slice(-2),
    ['settings-menu', 'settings/profile']
  );
  assert.equal(core.classifyPage('/octo/repo/settings/actions', dictionary.scopes).pageType, 'repository/settings/actions');
  assert.equal(core.classifyPage('/organizations/acme/settings/profile', dictionary.scopes).pageType, 'orgs/settings/profile');
});

test('审计页面类别剔除动态路径，同时保留词库范围匹配', () => {
  const cases = [
    ['/settings/apps/SyntheticPrivateApp/permissions', 'settings/apps'],
    ['/settings/SyntheticPrivateSection', 'settings'],
    ['/owner/repository/settings/environments/SyntheticPrivateEnvironment', 'repository/settings/environments'],
    ['/owner/repository/SyntheticPrivateRoute', 'repository'],
    ['/organizations/SyntheticPrivateOrg/settings/secrets/SyntheticPrivateSecret', 'orgs/settings/secrets'],
    ['/orgs/SyntheticPrivateOrg/SyntheticPrivateRoute', 'orgs'],
    ['/apps/SyntheticPrivateApp', 'apps'],
    ['/sponsors/SyntheticPrivateUser', 'sponsors']
  ];
  for (const [pathname, expected] of cases) {
    assert.equal(core.classifyPage(pathname, dictionary.scopes).pageType, expected, pathname);
  }
  assert.equal(core.normalizePageType('https://example.test/private'), 'unknown');
  assert.equal(core.normalizePageType(undefined), 'unknown');
  assert.equal(core.normalizePageType('settings/apps/SyntheticPrivateApp'), 'settings/apps');
});

test('优先级为官方覆盖、页面词条、公共词条、正则词条', () => {
  const pageTranslator = core.createTranslator({ dictionary, pathname: '/settings/profile' });
  assert.equal(pageTranslator.translate('Settings').value, '个人设置');
  assert.equal(pageTranslator.translate('Save').value, '保存');
  assert.equal(pageTranslator.translate('12 issues').value, '12 个议题');

  const officialTranslator = core.createTranslator({
    dictionary,
    pathname: '/settings/profile',
    overrides: { exact: { Settings: '官方设置' } }
  });
  assert.equal(officialTranslator.translate('Settings').value, '官方设置');
});

test('翻译保留原始空白并支持标题', () => {
  const translator = core.createTranslator({ dictionary, pathname: '/' });
  assert.equal(translator.translate('\n  Save  ').value, '\n  保存  ');
  assert.equal(translator.translateTitle('Account settings').value, '账户设置');
  assert.equal(translator.translate('Unlisted phrase').matched, false);
});

test('明确保留英文的覆盖与真正未知词条可区分', () => {
  const translator = core.createTranslator({ dictionary, overrides: { exact: { GitHub: 'GitHub' } } });
  assert.equal(translator.translate('GitHub').matched, false);
  assert.equal(translator.translate('GitHub').known, true);
  assert.equal(translator.translate('Mystery Command').known, false);
});

test('漏译候选过滤 URL、代码、文件名、哈希和中文', () => {
  assert.equal(core.looksLikeEnglishUi('Mystery command'), true);
  assert.equal(core.looksLikeEnglishUi('https://github.com/example'), false);
  assert.equal(core.looksLikeEnglishUi('const value = 1'), false);
  assert.equal(core.looksLikeEnglishUi('content.js'), false);
  assert.equal(core.looksLikeEnglishUi('a385982155efc1c234b3fb9fabe748873af300c3'), false);
  assert.equal(core.looksLikeEnglishUi('中文 Settings'), false);
});

test('人工官方术语覆盖核心 GitHub 词汇', () => {
  const source = fs.readFileSync(path.join(rootDir, 'src/official-overrides.js'), 'utf8');
  const sandbox = { globalThis: {} };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  const exact = sandbox.globalThis.GITHUB_ZH_OFFICIAL_OVERRIDES.exact;
  assert.equal(exact['Pull requests'], '拉取请求');
  assert.equal(exact.Repositories, '仓库');
  assert.equal(exact.Issues, '议题');
  assert.equal(exact.Settings, '设置');
});
