// 离线包的 i18n 目录准备。
//
// 这里要绕一个 Docusaurus 的命名约束：
// 离线构建用 disableVersioning: true，插件只认 "current" 这一个版本，
// 于是它去 i18n/<locale>/docusaurus-plugin-content-docs/current/ 找译文；
// 但在线站里 current 指的是 docs/（开发版），已发布版本的译文放在 version-1.2.2/ 下。
// 两边都叫 current，指向的内容却不是一回事。
//
// 所以离线构建不去动仓库里的 i18n/，而是生成一份临时目录 .i18n-offline/：
// 把目标版本的译文复制进 current/，再把 i18n.path 指过去。
// 构建结束后这份目录可以直接留着（已在 .gitignore 里），下次覆盖。
import fs from 'node:fs';
import path from 'node:path';

import {siteDir, loadLocales, localeRoot, PLUGIN_DIRS} from './locales.mjs';

export const OFFLINE_I18N_DIR = '.i18n-offline';

// versioned_docs/version-1.2.2 → version-1.2.2；docs → current
export function versionKeyOf(docsPath) {
  return docsPath === 'docs' ? 'current' : path.basename(docsPath);
}

function copyIfExists(from, to) {
  if (!fs.existsSync(from)) return false;
  fs.mkdirSync(path.dirname(to), {recursive: true});
  fs.cpSync(from, to, {recursive: true});
  return true;
}

export function prepareOfflineI18n({docsPath}) {
  const locales = loadLocales();
  const versionKey = versionKeyOf(docsPath);
  const outRoot = path.join(siteDir, OFFLINE_I18N_DIR);

  // 没有目标语言时不留目录：离线配置靠这个目录的存在与否判断要不要开多语言，
  // 留个空壳会让它误以为自己支持多语言
  if (!locales.targets.length) {
    return {dir: OFFLINE_I18N_DIR, versionKey, prepared: []};
  }

  fs.rmSync(outRoot, {recursive: true, force: true});
  fs.mkdirSync(outRoot, {recursive: true});

  const prepared = [];
  for (const locale of locales.offline) {
    if (locale.code === locales.defaultLocale) continue; // 源语言不需要译文目录
    const sourceRoot = localeRoot(locale.code);
    if (!fs.existsSync(sourceRoot)) continue;

    const targetRoot = path.join(outRoot, locale.code);

    copyIfExists(
      path.join(sourceRoot, 'code.json'),
      path.join(targetRoot, 'code.json'),
    );
    copyIfExists(
      path.join(sourceRoot, PLUGIN_DIRS.theme),
      path.join(targetRoot, PLUGIN_DIRS.theme),
    );

    // 文档正文：version-X/ 的译文搬到 current/
    const docsFrom = path.join(sourceRoot, PLUGIN_DIRS.docs, versionKey);
    const docsTo = path.join(targetRoot, PLUGIN_DIRS.docs, 'current');
    const hasDocs = copyIfExists(docsFrom, docsTo);

    // 侧边栏/版本标签：version-X.json 改名成 current.json
    const versionJsonFrom = path.join(sourceRoot, PLUGIN_DIRS.docs, `${versionKey}.json`);
    const versionJsonTo = path.join(targetRoot, PLUGIN_DIRS.docs, 'current.json');
    const hasJson = copyIfExists(versionJsonFrom, versionJsonTo);

    // 该语言完全没有译文时跳过，交给 Docusaurus 逐文件回退到默认语言
    if (!hasDocs && !hasJson && !fs.existsSync(path.join(targetRoot, 'code.json'))) {
      fs.rmSync(targetRoot, {recursive: true, force: true});
      continue;
    }
    prepared.push({code: locale.code, label: locale.label});
  }

  return {dir: OFFLINE_I18N_DIR, versionKey, prepared};
}

// 直接执行时打印结果，方便单独跑一下看目录对不对
if (process.argv[1] && process.argv[1].endsWith('prepare-offline.mjs')) {
  const docsPath = process.argv[2] || 'docs';
  const result = prepareOfflineI18n({docsPath});
  console.log(
    `[i18n] 离线译文目录就绪: ${result.dir}（版本键 ${result.versionKey}）` +
      (result.prepared.length
        ? `，语言: ${result.prepared.map((item) => item.code).join(', ')}`
        : '，没有目标语言译文'),
  );
}
