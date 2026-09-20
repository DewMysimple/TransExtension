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

test('已收录界面词可忽略内部排版空白，保留原始边界且不模糊匹配', () => {
  const translator = core.createTranslator({ dictionary, overrides });
  assert.equal(translator.translate('\tRecently\u00a0 \nviewed  ').value, '\t最近查看  ');
  assert.equal(translator.translate('recently viewed').matched, false);
  assert.equal(translator.translate('My Recently viewed file').matched, false);
  const raw = core.createTranslator({ dictionary: { exact: { 'Search ': '搜索' }, patterns: [] } });
  assert.equal(raw.translate('Search ').value, '搜索 ');
});

test('规范化词条冲突不猜译，明确原文仍精确匹配', () => {
  const translator = core.createTranslator({
    dictionary: {
      exact: { 'View  settings': '视图设置', 'View settings': '查看设置' },
      patterns: [{ source: '^(.+)settings$', replacement: '猜测 {1}' }]
    }
  });
  assert.equal(translator.translate('View\nsettings').matched, false);
  assert.equal(translator.translate('View\tsettings').matched, false);
  assert.equal(translator.translate('View  settings').value, '视图设置');
  assert.equal(translator.translate('View settings').value, '查看设置');
});

test('精确词条的各类空白变体仍遵守人工覆盖优先级', () => {
  const translator = core.createTranslator({
    dictionary: { exact: { 'Search ': '上游错误译文', 'Recently  viewed': '上游过期译文' }, patterns: [] },
    overrides
  });
  assert.equal(translator.translate('Search ').value, '搜索 ');
  assert.equal(translator.translate('Recently  viewed').value, '最近查看');
});

test('保留英文的人工覆盖阻止模板重译，并标记为已收录', () => {
  const translator = core.createTranslator({
    dictionary: { exact: { FigJam: '错误品牌译文' }, patterns: [{ source: '^(.+)$', replacement: '错误 {1}' }] },
    overrides: { exact: { FigJam: 'FigJam' } }
  });
  const result = translator.translate('  FigJam\n');
  assert.equal(result.matched, false);
  assert.equal(result.known, true);
  assert.equal(result.value, '  FigJam\n');
});

test('较具体的模板优先于通用数量模板', () => {
  const translator = core.createTranslator({ dictionary: {
    exact: {},
    patterns: [
      { source: '^(.+) members$', replacement: '{1} 位成员' },
      { source: '^Access options for (.+) members$', replacement: '{1} 位成员的访问选项' }
    ]
  } });
  assert.equal(translator.translate('Access options for 12 members').value, '12 位成员的访问选项');
  assert.equal(translator.translate('12 members').value, '12 位成员');
  assert.equal(translator.translate('12 members', { allowPatterns: false }).matched, false);
});

test('模板捕获原样保留美元符号与占位符形式的用户名称', () => {
  assert.equal(core.applyPattern('Move $& {2} to Team', {
    source: '^Move (.+) to (.+)$', replacement: '将 {1} 移至 {2}'
  }), '将 $& {2} 移至 Team');
  assert.equal(core.applyPattern('Move $& {@} to Team', {
    source: '^Move (.+) to (.+)$', replacement: '将 {@} 移至 {@}'
  }), '将 $& {@} 移至 Team');
});

test('模板只匹配完整文本，重复调用无正则状态残留，坏词条不影响其余词条', () => {
  assert.equal(core.applyPattern('prefix 12 members suffix', { source: '(\\d+) members', replacement: '{1} 位成员' }), null);
  const translator = core.createTranslator({ dictionary: {
    exact: {}, patterns: [
      { source: '[', replacement: '坏词条' },
      { source: '^(\\d+) members$', flags: 'g', replacement: '{1} 位成员' }
    ]
  } });
  assert.equal(translator.translate('12 members').value, '12 位成员');
  assert.equal(translator.translate('12 members').value, '12 位成员');
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

const coverage = JSON.parse(fs.readFileSync(path.join(testDir, 'fixtures/figma-ui-coverage.json'), 'utf8'));
const bundled = { globalThis: {} };
vm.createContext(bundled);
for (const file of ['generated/dictionary.js', 'src/official-overrides.js']) {
  vm.runInContext(fs.readFileSync(path.join(rootDir, file), 'utf8'), bundled);
}

for (const scenario of coverage.scenarios) {
  test(`真实交付词库覆盖：${scenario.name}`, () => {
    const translator = core.createTranslator({
      dictionary: bundled.globalThis.FIGMA_ZH_DICTIONARY,
      overrides: bundled.globalThis.FIGMA_ZH_OFFICIAL_OVERRIDES,
      pathname: scenario.pathname
    });
    for (const [english, chinese] of Object.entries(scenario.cases)) {
      assert.equal(translator.translate(english).value, chinese, english);
    }
  });
}

test('真实交付模板保留动态名称，较具体的模板优先', () => {
  const translator = core.createTranslator({ dictionary: bundled.globalThis.FIGMA_ZH_DICTIONARY });
  assert.equal(translator.translate('Access options for 12 members').value, '12 成员的访问选项');
  assert.equal(translator.translate('Rename $& {2}').value, '重命名 $& {2}');
});
