#!/usr/bin/env node
// 译文完整性检查，给 CI 当闸门用。
//
//   npm run i18n:check                 # 有缺失只报告，退出码 0
//   npm run i18n:check -- --strict     # 有缺失就失败（PR 里建议开）
//   npm run i18n:check -- --markdown   # 输出 Markdown 表格，方便贴 PR 评论
//
// 判定依据和翻译脚本共用 .i18n-cache.json：源文件哈希变了就算"过期"，
// 目标文件不存在就算"缺失"。不猜内容、不做模糊匹配。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import {siteDir, loadLocales, listDocSources, targetPathFor} from './locales.mjs';

const CACHE_FILE = path.join(siteDir, '.i18n-cache.json');
const CJK = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/;

const sha1 = (text) => crypto.createHash('sha1').update(text).digest('hex').slice(0, 16);

function parseArgs(argv) {
  const options = {strict: false, markdown: false, locales: [], allVersions: false};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--strict') options.strict = true;
    else if (arg === '--markdown') options.markdown = true;
    else if (arg === '--all-versions') options.allVersions = true;
    else if (arg === '--locale' || arg === '-l') {
      options.locales.push(...String(argv[++i] ?? '').split(',').map((s) => s.trim()));
    }
  }
  return options;
}

function loadCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  } catch {
    return {files: {}, json: {}};
  }
}

function selectVersions(allVersions) {
  if (allVersions) return null;
  const versions = ['current'];
  try {
    const released = JSON.parse(fs.readFileSync(path.join(siteDir, 'versions.json'), 'utf8'));
    if (released[0]) versions.push(`version-${released[0]}`);
  } catch {
    // 没有 versions.json 就只查 current
  }
  return new Set(versions);
}

// 译文里还残留大段中文，通常意味着机翻漏了或者整段回退了原文
function looksUntranslated(text, isTargetCjk) {
  if (isTargetCjk) return false;
  const cjkCount = (text.match(new RegExp(CJK, 'g')) ?? []).length;
  return cjkCount > 20;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const locales = loadLocales();
  const cache = loadCache();
  const versionFilter = selectVersions(options.allVersions);

  const wanted = options.locales.length
    ? locales.targets.filter((item) => options.locales.includes(item.code))
    : locales.targets;

  if (!wanted.length) {
    console.log('[i18n:check] locales.json 里没有目标语言，跳过。');
    return 0;
  }

  const sources = listDocSources().filter(
    (entry) => !versionFilter || versionFilter.has(entry.versionKey),
  );

  const report = [];
  let missingTotal = 0;
  let staleTotal = 0;
  let suspiciousTotal = 0;

  for (const locale of wanted) {
    const isTargetCjk = CJK.test(locale.label) || /^(ja|ko|zh)/i.test(locale.code);
    const missing = [];
    const stale = [];
    const suspicious = [];

    for (const entry of sources) {
      const target = targetPathFor(entry, locale.code);
      const key = `${locale.code}|${entry.rel}`;
      if (!fs.existsSync(target)) {
        missing.push(entry.rel);
        continue;
      }
      const raw = fs.readFileSync(entry.abs, 'utf8');
      if (cache.files?.[key]?.src !== sha1(raw)) {
        stale.push(entry.rel);
      }
      if (looksUntranslated(fs.readFileSync(target, 'utf8'), isTargetCjk)) {
        suspicious.push(entry.rel);
      }
    }

    missingTotal += missing.length;
    staleTotal += stale.length;
    suspiciousTotal += suspicious.length;
    report.push({locale, total: sources.length, missing, stale, suspicious});
  }

  if (options.markdown) {
    const lines = ['| 语言 | 应译 | 缺失 | 过期 | 疑似未译 |', '| --- | --- | --- | --- | --- |'];
    for (const item of report) {
      lines.push(
        `| ${item.locale.label} (\`${item.locale.code}\`) | ${item.total} | ${item.missing.length} | ${item.stale.length} | ${item.suspicious.length} |`,
      );
    }
    console.log(lines.join('\n'));
    const first = report.find((item) => item.missing.length || item.stale.length);
    if (first) {
      const sample = [...first.missing, ...first.stale].slice(0, 20);
      console.log(`\n<details><summary>${first.locale.code} 待补清单（前 ${sample.length} 项）</summary>\n`);
      console.log(sample.map((rel) => `- \`${rel}\``).join('\n'));
      console.log('\n</details>');
    }
  } else {
    for (const item of report) {
      console.log(
        `[${item.locale.code}] 应译 ${item.total}，缺失 ${item.missing.length}，` +
          `过期 ${item.stale.length}，疑似未译 ${item.suspicious.length}`,
      );
      for (const rel of item.missing.slice(0, 10)) console.log(`  - 缺失 ${rel}`);
      if (item.missing.length > 10) console.log(`  … 还有 ${item.missing.length - 10} 个缺失`);
      for (const rel of item.stale.slice(0, 10)) console.log(`  - 过期 ${rel}`);
      if (item.stale.length > 10) console.log(`  … 还有 ${item.stale.length - 10} 个过期`);
    }
  }

  const hasGap = missingTotal + staleTotal > 0;
  if (hasGap && options.strict) {
    console.error(
      `\n[i18n:check] 不通过：${missingTotal} 篇缺失 + ${staleTotal} 篇过期。` +
        `\n              本地运行 npm run i18n:sync 补齐后再提交。`,
    );
    return 1;
  }
  if (hasGap) {
    console.log(
      `\n[i18n:check] 有 ${missingTotal} 篇缺失、${staleTotal} 篇过期（未开启 --strict，不判失败）。`,
    );
  } else {
    console.log('\n[i18n:check] 译文完整。');
  }
  return 0;
}

process.exit(main());
