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
  exact: { Search: '查找', Settings: '设置', 'Recently viewed': '最近使用' },
  patterns: [{ source: '^(.+) members$', flags: '', replacement: '{1} 位成员' }]
};
const overrides = {
  exact: { Search: '搜索' },
  routes: { files: { 'Recently viewed': '最近查看' } }
};

test('识别文件浏览器、编辑器、设置、管理和社区路由', () => {
  assert.equal(core.classifyPage('/files/team/123/recents-and-sharing/recently-viewed'), 'files');
  assert.equal(core.classifyPage('/design/abc/Project'), 'editor');
  assert.equal(core.classifyPage('/board/abc/Workshop'), 'editor');
  assert.equal(core.classifyPage('/slides/abc/Deck'), 'editor');
  assert.equal(core.classifyPage('/settings'), 'settings');
  assert.equal(core.classifyPage('/admin/team'), 'admin');
  assert.equal(core.classifyPage('/community'), 'community');
});

test('优先级为路由覆盖、人工覆盖、社区词库、模板词条', () => {
  const translator = core.createTranslator({ dictionary, overrides, pathname: '/files/team/123' });
  assert.equal(translator.translate('Recently viewed').value, '最近查看');
  assert.equal(translator.translate('Search').value, '搜索');
  assert.equal(translator.translate('Settings').value, '设置');
  assert.equal(translator.translate('12 members').value, '12 位成员');
});

test('精确翻译保留首尾空白，未知词保持不变', () => {
  const translator = core.createTranslator({ dictionary, overrides, pathname: '/' });
  assert.equal(translator.translate('  Settings\n').value, '  设置\n');
  assert.equal(translator.translate('Product roadmap').matched, false);
});

test('漏译候选过滤网址、代码、邮箱、哈希和中文', () => {
  assert.equal(core.looksLikeEnglishUi('Mystery action'), true);
  assert.equal(core.looksLikeEnglishUi('https://figma.com/files'), false);
  assert.equal(core.looksLikeEnglishUi('const value = 1'), false);
  assert.equal(core.looksLikeEnglishUi('design.json'), false);
  assert.equal(core.looksLikeEnglishUi('1659438203074193867'), false);
  assert.equal(core.looksLikeEnglishUi('中文 Settings'), false);
});

test('人工术语覆盖核心 Figma 文件浏览器词汇', () => {
  const source = fs.readFileSync(path.join(rootDir, 'src/official-overrides.js'), 'utf8');
  const sandbox = { globalThis: {} };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  const data = sandbox.globalThis.FIGMA_ZH_OFFICIAL_OVERRIDES;
  assert.equal(data.exact.Drafts, '草稿');
  assert.equal(data.exact.Community, '社区');
  assert.equal(data.exact.Settings, '设置');
  assert.equal(data.routes.files['Recently viewed'], '最近查看');
});
