#!/usr/bin/env node
// 加一门语言。
//
//   npm run i18n:add -- en "English"
//   npm run i18n:add -- ja "日本語" --no-offline     # 不进离线包
//
// 做三件事：写进 locales.json、生成 i18n/<code>/ 的文案骨架、
// 打印后续命令。真正的译文交给 i18n:sync，这个脚本不发任何网络请求。
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

import {siteDir, loadLocales, localeRoot} from './locales.mjs';

function parseArgs(argv) {
  const options = {code: '', label: '', offline: true, skeleton: true};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--no-offline') options.offline = false;
    else if (arg === '--no-skeleton') options.skeleton = false;
    else if (!arg.startsWith('-')) positional.push(arg);
  }
  options.code = positional[0] ?? '';
  options.label = positional[1] ?? '';
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.code) {
    console.error(
      '用法: npm run i18n:add -- <语言代码> "<语言自称>" [--no-offline] [--no-skeleton]\n' +
        '例如: npm run i18n:add -- en "English"',
    );
    return 1;
  }
  if (!/^[a-z]{2,3}(-[A-Za-z0-9]+)?$/.test(options.code)) {
    console.error(`[i18n:add] 语言代码不合法: ${options.code}（用 BCP47，例如 en / ja / pt-BR）`);
    return 1;
  }

  const file = path.join(siteDir, 'locales.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (data.locales.some((item) => item.code === options.code)) {
    console.error(`[i18n:add] ${options.code} 已经在 locales.json 里了`);
    return 1;
  }

  // label 是给语言切换器用的自称，缺省时先填语言代码，之后可以手改
  const label = options.label || options.code;
  data.locales.push({
    code: options.code,
    label,
    htmlLang: options.code,
    direction: 'ltr',
    offline: options.offline,
  });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  console.log(`[i18n:add] 已写入 locales.json: ${options.code}（${label}）`);

  if (options.skeleton) {
    const bin = path.join(siteDir, 'node_modules', '@docusaurus', 'core', 'bin', 'docusaurus.mjs');
    if (fs.existsSync(bin)) {
      console.log('[i18n:add] 生成文案骨架…');
      const result = spawnSync(
        process.execPath,
        [bin, 'write-translations', '--locale', options.code],
        {cwd: siteDir, stdio: 'inherit', env: process.env},
      );
      if (result.status !== 0) {
        console.warn('[i18n:add] write-translations 失败，可以稍后手动重跑');
      }
    } else {
      console.warn('[i18n:add] 没找到 docusaurus，跳过骨架生成（先 npm install）');
    }
  }

  fs.mkdirSync(path.join(localeRoot(options.code), 'docusaurus-plugin-content-docs', 'current'), {
    recursive: true,
  });

  const locales = loadLocales();
  console.log(`
下一步:
  1. 配置翻译服务（环境变量，可写进 .env.local 或 CI secrets）:
       AI_BASE_URL=https://api.deepseek.com/v1
       AI_API_KEY=...
       AI_MODEL=deepseek-chat
  2. 预演，看会翻哪些文件:
       npm run i18n:sync -- --locale ${options.code} --dry-run
  3. 正式翻译:
       npm run i18n:sync -- --locale ${options.code}
  4. 本地构建确认:
       npm run build

当前语言: ${locales.all.map((item) => item.code).join(', ')}
提示: 历史版本默认不翻（只翻 current + 最新已发布版），需要时加 --all-versions。`);
  return 0;
}

process.exit(main());
