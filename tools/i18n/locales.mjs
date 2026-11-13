// 语言清单与路径推导。
//
// locales.json 是全仓唯一事实来源：站点配置、翻译脚本、离线构建、CI 都读它。
// 加一门语言 = 往 locales.json 加一项，其余地方不需要改代码。
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// tools/i18n/ → 仓库根
export const siteDir = path.resolve(here, '..', '..');

export const I18N_DIR = 'i18n';

// Docusaurus 的 i18n 目录命名规则，集中在这里，避免各处手拼
export const PLUGIN_DIRS = {
  docs: 'docusaurus-plugin-content-docs',
  changelog: 'docusaurus-plugin-content-docs-changelog',
  theme: 'docusaurus-theme-classic',
};

export function loadLocales() {
  const file = path.join(siteDir, 'locales.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(data.locales) || !data.locales.length) {
    throw new Error('[i18n] locales.json 里 locales 必须是非空数组');
  }
  const codes = data.locales.map((item) => item.code);
  if (!data.defaultLocale) {
    throw new Error('[i18n] locales.json 缺少 defaultLocale');
  }
  if (!codes.includes(data.defaultLocale)) {
    throw new Error(
      `[i18n] defaultLocale "${data.defaultLocale}" 不在 locales 列表里（${codes.join(', ')}）`,
    );
  }
  const duplicated = codes.filter((code, i) => codes.indexOf(code) !== i);
  if (duplicated.length) {
    throw new Error(`[i18n] locales.json 里语言重复: ${duplicated.join(', ')}`);
  }
  return {
    defaultLocale: data.defaultLocale,
    all: data.locales,
    default: data.locales.find((item) => item.code === data.defaultLocale),
    // 需要译文的语言（排除源语言本身）
    targets: data.locales.filter((item) => item.code !== data.defaultLocale),
    // 要打进离线包的语言
    offline: data.locales.filter((item) => item.offline !== false),
  };
}

export function localeRoot(code) {
  return path.join(siteDir, I18N_DIR, code);
}

export function docsPluginDir(code, versionKey) {
  return path.join(localeRoot(code), PLUGIN_DIRS.docs, versionKey);
}

// 版本目录名 ↔ Docusaurus 版本名：docs/ 对应 current，versioned_docs/version-1.2.2 对应 version-1.2.2
export const DOCS_SOURCE = 'docs';
export const VERSIONED_DIR = 'versioned_docs';
export const CHANGELOG_SOURCE = 'changelog';

const DOC_EXT = /\.mdx?$/i;

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      walk(abs, acc);
    } else if (DOC_EXT.test(entry.name)) {
      acc.push(abs);
    }
  }
  return acc;
}

// 列出所有需要翻译的文档，带上它属于哪个 docs 实例、哪个版本。
// 版本快照（versioned_docs/version-*）也在内：历史版本通常不翻，
// 但由调用方按需过滤，脚本本身不预设策略。
export function listDocSources() {
  const entries = [];

  const add = (absSource, group, versionKey) => {
    entries.push({
      abs: absSource,
      rel: path.relative(siteDir, absSource).split(path.sep).join('/'),
      group,
      versionKey,
    });
  };

  for (const abs of walk(path.join(siteDir, DOCS_SOURCE))) {
    add(abs, 'docs', 'current');
  }

  const versionedRoot = path.join(siteDir, VERSIONED_DIR);
  if (fs.existsSync(versionedRoot)) {
    for (const entry of fs.readdirSync(versionedRoot, {withFileTypes: true})) {
      if (!entry.isDirectory() || !entry.name.startsWith('version-')) continue;
      for (const abs of walk(path.join(versionedRoot, entry.name))) {
        // entry.name 本身就是 version-1.2.2，和 Docusaurus 的版本名一致
        add(abs, 'docs', entry.name);
      }
    }
  }

  for (const abs of walk(path.join(siteDir, CHANGELOG_SOURCE))) {
    add(abs, 'changelog', 'current');
  }

  return entries;
}

// 源文档 → 译文路径。文件名、目录层级完全镜像，只换根。
export function targetPathFor(entry, code) {
  const pluginDir =
    entry.group === 'changelog' ? PLUGIN_DIRS.changelog : PLUGIN_DIRS.docs;
  const base =
    entry.group === 'changelog'
      ? path.join(localeRoot(code), pluginDir, 'current')
      : path.join(localeRoot(code), pluginDir, entry.versionKey);
  const sourceRoot =
    entry.group === 'changelog'
      ? path.join(siteDir, CHANGELOG_SOURCE)
      : entry.versionKey === 'current'
        ? path.join(siteDir, DOCS_SOURCE)
        : path.join(siteDir, VERSIONED_DIR, entry.versionKey);
  return path.join(base, path.relative(sourceRoot, entry.abs));
}

// write-translations 把侧边栏/导航文案写在这些 JSON 里，key 形如 sidebar.rmtSidebar.category.软件介绍
export function listTranslationJson(code) {
  const root = localeRoot(code);
  const files = [];
  const walkJson = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walkJson(abs);
      else if (entry.name.endsWith('.json')) files.push(abs);
    }
  };
  walkJson(root);
  return files;
}
