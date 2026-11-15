#!/usr/bin/env node
// 多语言同步入口。
//
//   npm run i18n:sync                 # 翻 current + 最新已发布版本，跳过没变的文件
//   npm run i18n:sync -- --locale en  # 只处理某门语言
//   npm run i18n:sync -- --all-versions
//   npm run i18n:sync -- --force      # 忽略缓存全量重翻
//   npm run i18n:sync -- --dry-run    # 只打印计划，不调模型、不写文件
//
// 增量靠 .i18n-cache.json：记录每篇源文档的哈希，源没变就不重复花钱。
// 这个文件要提交进仓库，CI 才能接着上一轮的进度跑。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';

import {
  siteDir,
  loadLocales,
  listDocSources,
  targetPathFor,
  listTranslationJson,
  localeRoot,
} from './locales.mjs';
import {
  parseFrontMatter,
  collectFrontMatterValues,
  applyFrontMatterTranslations,
  protect,
  restore,
  splitBlocks,
  parseBatch,
  SPLIT_TOKEN,
} from './markdown.mjs';
import {resolveProvider, describeEnvHints} from './providers.mjs';

const CACHE_FILE = path.join(siteDir, '.i18n-cache.json');
const GLOSSARY_FILE = path.join(siteDir, 'tools', 'i18n', 'glossary.json');
// 单次请求的正文上限（字符）。太大容易触发输出截断，太小则请求数暴涨。
const BATCH_CHARS = 3200;
const CJK = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/;

const sha1 = (text) => crypto.createHash('sha1').update(text).digest('hex').slice(0, 16);

function parseArgs(argv) {
  const options = {
    locales: [],
    force: false,
    dryRun: false,
    limit: Infinity,
    concurrency: Number(process.env.AI_CONCURRENCY) || 3,
    allVersions: false,
    allMessages: false,
    docsOnly: false,
    jsonOnly: false,
    skipWriteTranslations: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--locale':
      case '-l':
        options.locales.push(...String(argv[++i] ?? '').split(',').map((s) => s.trim()));
        break;
      case '--force':
        options.force = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--limit':
        options.limit = Number(argv[++i]) || Infinity;
        break;
      case '--concurrency':
        options.concurrency = Math.max(1, Number(argv[++i]) || 1);
        break;
      case '--all-versions':
        options.allVersions = true;
        break;
      case '--all-messages':
        options.allMessages = true;
        break;
      case '--docs-only':
        options.docsOnly = true;
        break;
      case '--json-only':
        options.jsonOnly = true;
        break;
      case '--skip-write-translations':
        options.skipWriteTranslations = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        if (arg.startsWith('-')) {
          console.error(`[i18n] 未知参数: ${arg}`);
          process.exit(1);
        }
    }
  }
  return options;
}

function printHelp() {
  console.log(`用法: npm run i18n:sync -- [选项]

选项:
  -l, --locale <code>     只处理指定语言，可逗号分隔；默认处理 locales.json 里全部目标语言
      --all-versions      连历史版本快照一起翻；默认只翻 current + 最新已发布版
      --docs-only         只翻文档，不动 JSON 文案
      --json-only         只翻 JSON 文案（侧边栏、导航、页脚）
      --all-messages      连不含中日韩文字的 JSON 条目也翻（目标语言不是英文时有用）
      --force             忽略缓存，全部重翻
      --dry-run           只列出待翻文件，不调用模型
      --limit <n>         最多处理 n 个文件（调试用）
      --concurrency <n>   并发请求数，默认 3
      --skip-write-translations  不自动执行 docusaurus write-translations

环境变量（provider 通用，不绑定平台）:
${describeEnvHints().map((line) => `  ${line}`).join('\n')}`);
}

function loadGlossary() {
  try {
    const data = JSON.parse(fs.readFileSync(GLOSSARY_FILE, 'utf8'));
    return {keep: data.keep ?? [], preferred: data.preferred ?? {}};
  } catch {
    return {keep: [], preferred: {}};
  }
}

function loadCache() {
  try {
    const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    return {version: 1, files: data.files ?? {}, json: data.json ?? {}};
  } catch {
    return {version: 1, files: {}, json: {}};
  }
}

function saveCache(cache) {
  fs.writeFileSync(CACHE_FILE, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
}

function buildSystemPrompt({localeLabel, glossary}) {
  const keep = glossary.keep.length ? glossary.keep.join('、') : '（无）';
  const preferred = Object.entries(glossary.preferred)
    .map(([source, target]) => `- ${source} → ${target}`)
    .join('\n');
  return `你是 RMT 软件（AutoHotkey v2 自动化工具）技术文档的专职译者。
把用户给出的 Markdown 片段从简体中文翻译成 ${localeLabel}。

硬性规则：
1. 只输出译文本身。不要解释、不要总结、不要用 \`\`\` 包裹整段。
2. 每段译文前必须原样保留分隔符 ${SPLIT_TOKEN}，分隔符数量与顺序不得改变。
3. 形如 \uE00012\uE001 的占位符代表代码、链接地址或 JSX，必须原样保留在译文中，不能翻译、不能删除、不能跨段移动。
4. 保持 Markdown 结构完整：标题的 # 数量、列表符号（- / * / 1.）、表格的 | 与分隔行、引用 >、加粗斜体标记，都要与原文一一对应。
5. 专业术语按下表处理，除表中的词，其余一律翻译：
保持原样：${keep}
${preferred ? `固定译法：\n${preferred}` : ''}
6. 语气与原文一致：面向普通用户的操作说明要自然口语化，参数说明要精确。不要添加原文没有的内容。`;
}

// 把块按字数打包，保证一次请求不超长
function packBlocks(blocks) {
  const batches = [];
  let current = [];
  let size = 0;
  for (const block of blocks) {
    const cost = block.length + SPLIT_TOKEN.length + 2;
    if (current.length && size + cost > BATCH_CHARS) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(block);
    size += cost;
  }
  if (current.length) batches.push(current);
  return batches;
}

async function translateBatch({provider, blocks, localeLabel, glossary}) {
  const system = buildSystemPrompt({localeLabel, glossary});
  const user = blocks.map((block) => `${SPLIT_TOKEN}\n${block}`).join('\n\n');
  const raw = await provider.chat({system, user});
  const parts = parseBatch(raw, blocks.length);
  return parts;
}

// 短文本批量翻（front matter 的 title / sidebar_label 这种）
async function translateShortValues({provider, values, localeLabel, glossary}) {
  if (!values.length) return [];
  const system = buildSystemPrompt({localeLabel, glossary});
  const user = values.map((value) => `${SPLIT_TOKEN}\n${value}`).join('\n\n');
  const raw = await provider.chat({system, user});
  const parts = parseBatch(raw, values.length);
  if (!parts) {
    throw new Error('短文本批量翻译的分隔符对不上');
  }
  return parts;
}

async function translateDocFile({
  provider,
  entry,
  code,
  localeLabel,
  glossary,
  options,
  cache,
}) {
  const target = targetPathFor(entry, code);
  const key = `${code}|${entry.rel}`;
  const raw = fs.readFileSync(entry.abs, 'utf8');
  const srcHash = sha1(raw);

  if (!options.force && cache.files[key]?.src === srcHash && fs.existsSync(target)) {
    return {status: 'skip', rel: entry.rel};
  }
  if (options.dryRun) {
    return {status: 'pending', rel: entry.rel};
  }

  const {frontMatter, body} = parseFrontMatter(raw);

  // front matter: 先把要翻的字段值抽出来一起翻，再按原顺序回填
  let newFrontMatter = frontMatter;
  if (frontMatter) {
    const items = collectFrontMatterValues(frontMatter);
    if (items.length) {
      const translatedValues = await translateShortValues({
        provider,
        values: items.map((item) => item.value),
        localeLabel,
        glossary,
      });
      newFrontMatter = applyFrontMatterTranslations(frontMatter, items, translatedValues);
    }
  }

  // 正文：保护结构 → 切块 → 分批翻译 → 还原
  const {text: protectedBody, store} = protect(body);
  const blocks = splitBlocks(protectedBody);
  const translatedBlocks = [];

  for (const batch of packBlocks(blocks)) {
    let parts;
    try {
      parts = await translateBatch({provider, blocks: batch, localeLabel, glossary});
    } catch (error) {
      parts = null;
      console.warn(`[i18n] ${entry.rel}: 批次失败（${error.message}），该批保留原文`);
    }
    if (!parts) {
      translatedBlocks.push(...batch);
      continue;
    }
    translatedBlocks.push(...parts);
  }

  const restored = restore(translatedBlocks.join('\n\n'), store);
  const output = newFrontMatter ? `---\n${newFrontMatter}\n---\n\n${restored}` : restored;

  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.writeFileSync(target, output.endsWith('\n') ? output : `${output}\n`, 'utf8');

  cache.files[key] = {src: srcHash, out: sha1(output), at: new Date().toISOString()};
  return {status: 'translated', rel: entry.rel};
}

function runWriteTranslations(code) {
  const result = spawnSync(
    process.execPath,
    [
      path.join(siteDir, 'node_modules', '@docusaurus', 'core', 'bin', 'docusaurus.mjs'),
      'write-translations',
      '--locale',
      code,
    ],
    {cwd: siteDir, stdio: 'inherit', env: process.env},
  );
  if (result.status !== 0) {
    throw new Error(`[i18n] docusaurus write-translations --locale ${code} 失败`);
  }
}

async function translateJsonFiles({
  provider,
  code,
  localeLabel,
  glossary,
  options,
  cache,
}) {
  const files = listTranslationJson(code);
  let translated = 0;
  let skipped = 0;
  const pending = [];

  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8');
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      console.warn(`[i18n] 跳过无法解析的 JSON: ${path.relative(siteDir, file)}`);
      continue;
    }
    const rel = path.relative(localeRoot(code), file).split(path.sep).join('/');
    const messages = [];
    for (const [messageKey, value] of Object.entries(data)) {
      if (!value || typeof value.message !== 'string') continue;
      const message = value.message;
      const cacheKey = `${code}|${rel}#${messageKey}`;
      const cached = cache.json[cacheKey];
      // 已经翻过：message 与上次写回的内容一致，说明是译文不是源文
      if (!options.force && cached?.out === sha1(message)) {
        skipped++;
        continue;
      }
      // 不含中日韩字符的条目默认不动：code.json 里大量是 Docusaurus 自带英文文案，
      // 目标语言是英文时本来就没必要翻
      if (!options.allMessages && !CJK.test(message)) {
        skipped++;
        continue;
      }
      messages.push({messageKey, message, cacheKey});
    }
    if (messages.length) pending.push({file, data, rel, messages});
  }

  const totalPending = pending.reduce((sum, item) => sum + item.messages.length, 0);
  if (!totalPending) return {translated, skipped, pending: 0};
  if (options.dryRun) {
    return {translated: 0, skipped, pending: totalPending};
  }

  for (const item of pending) {
    const values = item.messages.map((entry) => entry.message);
    // 条目多时分批，避免超长
    const chunks = [];
    for (let i = 0; i < values.length; i += 40) chunks.push(values.slice(i, i + 40));
    const outputs = [];
    for (const chunk of chunks) {
      const parts = await translateShortValues({
        provider,
        values: chunk,
        localeLabel,
        glossary,
      });
      outputs.push(...parts);
    }
    item.messages.forEach((entry, index) => {
      const translatedMessage = outputs[index];
      if (typeof translatedMessage === 'string' && translatedMessage.trim()) {
        item.data[entry.messageKey].message = translatedMessage.trim();
        cache.json[entry.cacheKey] = {
          out: sha1(translatedMessage.trim()),
          at: new Date().toISOString(),
        };
        translated++;
      }
    });
    fs.writeFileSync(item.file, `${JSON.stringify(item.data, null, 2)}\n`, 'utf8');
  }

  return {translated, skipped, pending: 0};
}

function selectVersions(options) {
  if (options.allVersions) return null; // 不过滤
  const versions = ['current'];
  try {
    const released = JSON.parse(fs.readFileSync(path.join(siteDir, 'versions.json'), 'utf8'));
    if (released[0]) versions.push(`version-${released[0]}`);
  } catch {
    // versions.json 不存在（全新仓库）时只翻 current
  }
  return new Set(versions);
}

async function pool(items, size, worker) {
  let cursor = 0;
  const runners = Array.from({length: Math.min(size, items.length)}, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const locales = loadLocales();
  const glossary = loadGlossary();
  const cache = loadCache();

  const wanted = options.locales.length
    ? locales.targets.filter((item) => options.locales.includes(item.code))
    : locales.targets;

  if (!wanted.length) {
    console.log(
      '[i18n] locales.json 里没有可翻译的目标语言。\n' +
        '        加一门语言：npm run i18n:add -- en "English"',
    );
    return 0;
  }

  const missingLocale = options.locales.filter(
    (code) => !locales.all.some((item) => item.code === code),
  );
  if (missingLocale.length) {
    console.error(
      `[i18n] locales.json 里没有这些语言: ${missingLocale.join(', ')}\n` +
        `        先添加：npm run i18n:add -- ${missingLocale[0]} "<语言自称>"`,
    );
    return 1;
  }

  let provider = null;
  if (!options.dryRun) {
    provider = await resolveProvider(process.env, {siteDir});
    console.log(`[i18n] provider: ${provider.label}\n`);
  } else {
    console.log('[i18n] dry-run：只列计划，不调用模型\n');
  }

  const versionFilter = selectVersions(options);
  let failures = 0;
  let totalTranslated = 0;
  let totalSkipped = 0;
  let totalPending = 0;

  for (const locale of wanted) {
    console.log(`── ${locale.code}（${locale.label}） ──`);
    fs.mkdirSync(localeRoot(locale.code), {recursive: true});

    if (!options.docsOnly && !options.skipWriteTranslations && !options.dryRun) {
      runWriteTranslations(locale.code);
    }

    if (!options.jsonOnly) {
      const all = listDocSources().filter((entry) => {
        if (!versionFilter) return true;
        return versionFilter.has(entry.versionKey);
      });
      const queue = all.slice(0, options.limit);
      console.log(`  文档 ${queue.length} 篇（共 ${listDocSources().length} 篇候选）`);

      const results = [];
      await pool(queue, options.concurrency, async (entry) => {
        try {
          const result = await translateDocFile({
            provider,
            entry,
            code: locale.code,
            localeLabel: locale.label,
            glossary,
            options,
            cache,
          });
          results.push(result);
          if (result.status === 'translated') saveCache(cache);
        } catch (error) {
          failures++;
          results.push({status: 'failed', rel: entry.rel, error: error.message});
          console.error(`  ✗ ${entry.rel}: ${error.message}`);
        }
      });

      const translated = results.filter((item) => item.status === 'translated').length;
      const skipped = results.filter((item) => item.status === 'skip').length;
      const pending = results.filter((item) => item.status === 'pending').length;
      totalTranslated += translated;
      totalSkipped += skipped;
      totalPending += pending;
      console.log(`  文档结果：翻译 ${translated}，跳过 ${skipped}，待翻 ${pending}`);
    }

    if (!options.docsOnly) {
      const jsonResult = await translateJsonFiles({
        provider,
        code: locale.code,
        localeLabel: locale.label,
        glossary,
        options,
        cache,
      });
      if (!options.dryRun && jsonResult.translated) saveCache(cache);
      console.log(
        `  文案结果：翻译 ${jsonResult.translated} 条，跳过 ${jsonResult.skipped} 条` +
          (jsonResult.pending ? `，待翻 ${jsonResult.pending} 条` : ''),
      );
    }
    console.log('');
  }

  if (!options.dryRun) saveCache(cache);

  console.log(
    `[i18n] 完成：翻译 ${totalTranslated} 篇` +
      `，跳过 ${totalSkipped} 篇` +
      (totalPending ? `，待翻 ${totalPending} 篇（dry-run 或限额截断）` : '') +
      (failures ? `，失败 ${failures} 篇` : ''),
  );
  return failures ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`[i18n] ${error.message}`);
    process.exit(1);
  });
