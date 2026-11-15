// 离线版构建入口：支持命令行参数指定文档版本。
//
//   npm run build:offline                 默认取最新已发布版本
//   npm run build:offline -- 1.1.2        锁到 1.1.2
//   npm run build:offline -- --version 1.1.2
//   npm run build:offline -- -v next      取 docs/（未发布的开发版）
//
// 不经过 docusaurus CLI 传参，避免和它自己的选项冲突；
// 版本通过环境变量 RMT_DOC_VERSION 交给 docusaurus.offline.config.ts。
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {prepareOfflineI18n} from './i18n/prepare-offline.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(here, '..');

const argv = process.argv.slice(2);
let version = null;

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--version' || a === '-v') {
    version = argv[i + 1] ?? null;
    i++;
  } else if (a.startsWith('--version=')) {
    version = a.slice('--version='.length);
  } else if (!a.startsWith('-')) {
    version = a;
  }
}
if (!version) {
  version = process.env.RMT_DOC_VERSION?.trim() || '';
}

const versionsFile = path.join(siteRoot, 'versions.json');
const versions = fs.existsSync(versionsFile)
  ? JSON.parse(fs.readFileSync(versionsFile, 'utf8'))
  : [];

const usage = `用法: npm run build:offline -- [版本]
  不传        → 最新已发布版本（${versions[0] ?? '无'}）
  1.2.2       → versioned_docs/version-1.2.2
  next        → docs/（未发布的开发版）
可用版本: ${versions.join(', ') || '(无)'}`;

console.log(usage);
console.log(`构建版本: ${version || `最新已发布版 (${versions[0] ?? '无'})`}\n`);

const bin = path.join(siteRoot, 'node_modules', '@docusaurus', 'core', 'bin', 'docusaurus.mjs');
if (!fs.existsSync(bin)) {
  console.error(`[错误] 未找到 ${bin}\n先执行 npm install`);
  process.exit(1);
}

// 先清空产物目录，避免上一版残留的文件混进新包
const outDir = path.join(siteRoot, 'build-offline');
fs.rmSync(outDir, {recursive: true, force: true});

// 离线构建关闭了版本化，Docusaurus 只认 "current" 这个版本名，
// 所以要把目标版本的译文搬到 .i18n-offline/<locale>/.../current/ 再指过去。
// 没配任何目标语言时这一步什么也不做，配置里的 i18n.path 也不会生效。
const i18nInfo = prepareOfflineI18n({docsPath});
console.log(
  i18nInfo.prepared.length
    ? `[build:offline] 译文语言: ${i18nInfo.prepared.map((item) => item.code).join(', ')}（版本键 ${i18nInfo.versionKey}）`
    : '[build:offline] 无目标语言，离线包只出默认语言',
);

const res = spawnSync(
  process.execPath,
  [
    bin,
    'build',
    '--out-dir',
    'build-offline',
    '--config',
    'docusaurus.offline.config.ts',
  ],
  {
    cwd: siteRoot,
    stdio: 'inherit',
    env: {...process.env, RMT_DOC_VERSION: version},
  },
);

process.exit(res.status ?? 1);
