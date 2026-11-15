// 离线搜索索引构建：把 Docusaurus 构建出来的 route 表当成"权威路径表"，
// 从每条 doc 路由上拿到 { permalink, 源文件 } 的精确对应关系，再把源 md/mdx
// 抽成纯文本，产出一份自包含的索引。
//
// 为什么不复用在线那套 @easyops-cn/docusaurus-search-local：
// 它的索引是独立 json，客户端在 Web Worker 里 fetch 加载；file:// 协议下
// new Worker 和 fetch 都会被浏览器拒掉，所以离线包必须换一条路。
// 这里不猜路由：permalink 直接来自路由表，不需要在别处重新实现 slug 规则。

const fs = require('node:fs');
const path = require('node:path');

const SITE_PREFIX = '@site/';
// 单篇正文截断长度，防止某个超大页面把索引撑爆
const MAX_BODY = 20000;

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  } catch {
    return null;
  }
}

// 只解析 title / slug 这类简单标量，够用且不引依赖
function parseFrontMatter(raw) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!match) {
    return {data: {}, body: raw};
  }
  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    let value = kv[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    data[kv[1]] = value;
  }
  return {data, body: raw.slice(match[0].length)};
}

// 去掉 markdown / mdx 的语法噪音，只留下可检索的文字。
// 代码围栏里的内容是保留的 —— 指令手册里命令名就写在代码块里。
function cleanInline(input) {
  return String(input)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // 图片 → alt
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // 链接 → 文字
    .replace(/<\/?[A-Za-z][^>]*>/g, ' ') // HTML / JSX 标签
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ') // JSX 注释
    .replace(/\\\{/g, '{') // 转换脚本把裸写的 { 转义成了 \{
    .replace(/\\\}/g, '}')
    .replace(/`+/g, '')
    .replace(/[~*_]+/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractDoc(raw, fallbackTitle) {
  const {data, body} = parseFrontMatter(raw);
  const headings = [];
  const textLines = [];
  let inFence = false;

  for (const line of body.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) {
      if (/^\s*(import|export)\s/.test(line)) continue;
      const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
      if (heading) {
        const title = cleanInline(heading[2]);
        if (title) headings.push(title);
        // 正文里也保留标题文字，"搜索标题"和"搜索正文"都能命中
        textLines.push(heading[2]);
        continue;
      }
      // 表格分隔行 |---|---|、水平线 ---
      if (/^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line)) continue;
      if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) continue;
      // 列表符号
      if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
        textLines.push(line.replace(/^\s*(?:[-*+]|\d+\.)\s+/, ''));
        continue;
      }
      if (/^\s*>/.test(line)) {
        textLines.push(line.replace(/^\s*>\s?/, ''));
        continue;
      }
    }
    textLines.push(line);
  }

  const text = cleanInline(textLines.join(' '));
  return {
    title: data.title || headings[0] || fallbackTitle,
    headings,
    text: text.slice(0, MAX_BODY),
  };
}

function routeSource(route) {
  const content = route.modules && route.modules.content;
  if (typeof content === 'string') return content;
  if (content && typeof content.path === 'string') return content.path;
  return null;
}

function joinPath(p, parent) {
  if (!p) return parent || '/';
  if (p.startsWith('/')) return p;
  const base = !parent || parent === '/' ? '' : parent;
  return `${base}/${p}`;
}

// 路由表是嵌套的，doc 路由的特征是带 modules.content 指向 md/mdx 源文件
function collectDocRoutes(routes, parentPath, acc) {
  for (const route of routes || []) {
    const routePath = joinPath(route.path, parentPath);
    const source = routeSource(route);
    if (source && source.startsWith(SITE_PREFIX)) {
      acc.push({permalink: routePath, file: source.slice(SITE_PREFIX.length)});
    }
    if (route.routes) collectDocRoutes(route.routes, routePath, acc);
  }
  return acc;
}

// 分组名取最近的 _category_.json，和侧边栏分组一致。
// 目标语言没有 _category_.json（翻译流程只写 .md 和 current.json），
// 所以在源目录拿到中文标签后，再去该语言的 current.json 里换一次译名。
function findCategoryLabel(docsDir, absFile, categoryTranslations) {
  const root = path.resolve(docsDir);
  let dir = path.dirname(path.resolve(absFile));
  for (;;) {
    const raw = readText(path.join(dir, '_category_.json'));
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.label) {
          const label = String(parsed.label);
          return categoryTranslations[label] ?? label;
        }
      } catch {
        // 分组文件坏了就继续往上找，不影响搜索
      }
    }
    if (dir === root) return '';
    const parent = path.dirname(dir);
    if (parent === dir) return '';
    dir = parent;
  }
}

// current.json / version-x.json 里的分类译名：sidebar.<sidebarId>.category.<中文名>
function loadCategoryTranslations(jsonFile) {
  const raw = readText(jsonFile);
  if (!raw) return {};
  try {
    const data = JSON.parse(raw);
    const map = {};
    for (const [key, value] of Object.entries(data)) {
      const match = /^sidebar\.[^.]+\.category\.(.+)$/.exec(key);
      if (match && value && typeof value.message === 'string') {
        map[match[1]] = value.message;
      }
    }
    return map;
  } catch {
    return {};
  }
}

function normalizeRel(file) {
  return String(file).split(path.sep).join('/');
}

// 一条路由属于哪门语言：看源文件落在 i18n/<code>/ 还是 .i18n-offline/<code>/ 下。
// 不靠 URL 前缀判断，是因为离线包走 hash 路由，permalink 的前缀和文件位置不一定同源。
function detectLocale(file, localeCodes, defaultLocale) {
  const rel = normalizeRel(file);
  for (const code of localeCodes) {
    if (code === defaultLocale) continue;
    if (
      rel.includes(`/i18n/${code}/`) ||
      rel.startsWith(`i18n/${code}/`) ||
      rel.includes(`/.i18n-offline/${code}/`) ||
      rel.startsWith(`.i18n-offline/${code}/`)
    ) {
      return code;
    }
  }
  return defaultLocale;
}

/**
 * @param {object} params
 * @param {Array} params.routes     Docusaurus 路由表
 * @param {string} params.siteDir   站点根目录
 * @param {Array<{code:string, label?:string, docsPath:string, versionLabel?:string}>} params.locales
 * @param {string} params.defaultLocale
 */
function buildIndex({routes, siteDir, locales, defaultLocale}) {
  const localeCodes = locales.map((item) => item.code);
  const collected = collectDocRoutes(routes, '/', []);
  const result = {};
  const missing = [];

  for (const locale of locales) {
    const root = path.resolve(siteDir, locale.docsPath);
    // 分类译名和正文在同一个 i18n 目录下，只是文件名是 current.json / version-x.json
    const categories = loadCategoryTranslations(
      path.join(path.dirname(root), `${path.basename(root)}.json`),
    );
    const docs = [];
    const seen = new Set();

    for (const {permalink, file} of collected) {
      if (detectLocale(file, localeCodes, defaultLocale) !== locale.code) continue;
      const absFile = path.resolve(siteDir, file);
      // 只收本语言、本版本目录下的文件，防止把别的版本混进来
      if (absFile !== root && !absFile.startsWith(root + path.sep)) continue;
      if (seen.has(permalink)) continue;
      seen.add(permalink);

      const raw = readText(absFile);
      if (raw === null) {
        missing.push(file);
        continue;
      }
      const parsed = extractDoc(raw, path.basename(absFile).replace(/\.mdx?$/, ''));
      docs.push({
        t: parsed.title, // title
        p: permalink, // permalink
        c: findCategoryLabel(root, absFile, categories), // category
        h: parsed.headings, // headings
        b: parsed.text, // body
      });
    }

    result[locale.code] = {
      version: locale.versionLabel ?? '',
      label: locale.label ?? locale.code,
      docs,
    };
  }

  return {byLocale: result, missing};
}

module.exports = {buildIndex};
