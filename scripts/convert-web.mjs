// 把 RMT 发布包里的 Web/*.md 转成 Docusaurus 的文档页面。
// 用法：node scripts/convert-web.mjs
//
// 做三件事：
//   1. 按 "## 章节" 把一个大 md 拆成多个页面，落到分组目录里
//   2. 图片拷到 static/img/<版本>/，并把正文里的 /RMT/Web/Images/ 改掉
//   3. 生成各分组的 _category_.json 与版本快照的 versioned_sidebars
//
// 新版发布后：把新版本的 Web 目录放进 versioned_docs/version-<ver>/Web，
// 在 TARGETS 里加一条再跑一次即可。

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

// 源目录按顺序找，第一个存在就用：新版本直接放进 versioned_docs/version-<ver>/Web 即可
const TARGETS = [
  {
    srcs: ['versioned_docs/version-1.1.2/Web', '_demo-template/Web-1.1.2'],
    out: 'versioned_docs/version-1.1.2',
    img: '1.1.2',
  },
  {
    srcs: ['versioned_docs/version-1.2.2/Web', '_demo-template/Web-1.2.2'],
    out: 'versioned_docs/version-1.2.2',
    img: '1.2.2',
  },
  {
    srcs: ['versioned_docs/version-1.3/Web', '_demo-template/Web-1.3'],
    out: 'versioned_docs/version-1.3',
    img: '1.3',
  },
  {
    srcs: ['versioned_docs/version-1.2.2/Web', '_demo-template/Web-1.2.2'],
    out: 'docs',
    img: 'latest',
  },
];

// md 文件 -> 分组目录 / 中文名 / 侧边栏顺序
const FILES = [
  {file: '软件介绍.md', dir: 'guide', label: '软件介绍', position: 2},
  {file: '快速上手.md', dir: 'quickstart', label: '快速上手', position: 3},
  {file: '指令手册.md', dir: 'commands', label: '指令手册', position: 4},
  {file: '命令行.md', dir: 'cli', label: '命令行', position: 5},
  {file: '界面宏字段绑定支持表.md', dir: 'ui-bind', label: '界面宏字段绑定', position: 6},
  {file: '常见问题.md', dir: 'faq', label: '常见问题', position: 7},
  {file: '常见报错.md', dir: 'errors', label: '常见报错', position: 8},
  // 更新日志不随版本走：输出到项目根的 changelog/，由 docusaurus.config.ts 里的
  // 独立 docs 实例（routeBasePath: /changelog）承载，不进各版本侧边栏，离线包也不含。
  {file: '更新日志.md', dir: 'changelog', label: '更新日志', position: 9, split: false, root: true},
  // 开发指南不拆页：整篇作为单页 index.mdx（split:false 时标题层级保持源文档原貌）
  {file: '开发指南.md', dir: 'dev', label: '开发指南', position: 10, split: false},
];

// 章节名 -> 英文文件名。没写到的就用中文标题兜底。
const SLUGS = {
  全局操作: 'global-actions',
  页签说明: 'tabs',
  宏模块: 'macro-module',
  宏配置: 'macro-config',
  配置管理: 'config-manage',
  软件工具: 'tools',
  软件设置: 'settings',

  按键触发连点器: 'clicker',
  组合键触发宏: 'combo-key',
  按键触发组合键: 'key-to-combo',
  指令录制宏录制器: 'recorder',
  字串宏: 'string-macro',
  定时宏指定时间触发: 'timing-macro',
  搜索图片图像识别: 'search-image',
  搜索颜色: 'search-color',
  搜索文本OCR识别: 'search-text',
  鼠标移动: 'mouse-move',
  基础使用指南: 'basics',
  案例说明: 'examples',

  间隔: 'interval',
  按键: 'key',
  搜索: 'search',
  搜索Pro: 'search-pro',
  搜索Combo: 'search-combo',
  增量移动: 'delta-move',
  手柄: 'joy',
  手柄检测: 'joy-listen',
  Excel: 'excel',
  跳转: 'jump',
  等待: 'wait',
  等待确定: 'wait-confirm',
  时间: 'time',
  运行Pro: 'run-pro',
  移动: 'move',
  移动Pro: 'move-pro',
  输入: 'input',
  输出: 'output',
  循环: 'loop',
  宏操作: 'macro-op',
  变量: 'variable',
  变量提取: 'variable-extract',
  如果: 'if',
  如果Pro: 'if-pro',
  运算: 'operation',
  运行: 'run',
  文件读写: 'file-io',
  文本处理: 'text-ops',
  数组: 'array',
  RMT指令: 'rmt-cmd',
  后台鼠标: 'bg-mouse',
  后台按键: 'bg-key',
  窗口管理: 'window-manage',
  按键检测: 'key-check',
  注释: 'remark',
  抓图: 'shot',

  使用说明: 'usage',
  帮助: 'help',
  后台运行: 'background',
  启动指定宏: 'start-macro',
  终止指定宏: 'stop-macro',
  终止所有宏: 'stop-all',
  暂停指定宏: 'pause-macro',
  继续指定宏: 'resume-macro',
  暂停所有宏: 'pause-all',
  继续所有宏: 'resume-all',
  设置变量: 'set-var',
  获取变量: 'get-var',
  设置数组: 'set-array',
  获取数组: 'get-array',
  查询状态: 'status',

  控件与值类型: 'control-types',
  内联参数: 'inline-params',
  序列指令字段: 'sequence-fields',
  宏操作项与步骤开关: 'macro-action-fields',
  嵌套宏容器: 'nested-macro',
  暂不支持的字段: 'unsupported-fields',
  写入与占用: 'write-and-hold',

  如何迁移旧配置或导入加密分享包: 'migrate-config',
  如何提交Bug或功能建议: 'feedback',
  配置无法生效: 'config-not-applied',
  游戏中配置无效: 'in-game-invalid',
  侧键无法触发宏: 'side-button',
  部分宏按键无效: 'partial-key-invalid',
  配置突然失效: 'suddenly-invalid',
  罗技键鼠无效: 'logitech',
  指令丢失: 'cmd-lost',
  宏按键说明: 'key-state',
  宏按键状态说明: 'key-state',
  开机自启无效: 'autostart',

  运行报错1: 'runtime-error-1',
  运行报错2: 'runtime-error-2',
  运行报错3: 'runtime-error-3',
  配置迁移报错: 'migration-error',
  音频播放错误: 'audio-error',
  Excel读写失败: 'excel-error',
  文本识别功能异常: 'ocr-error',
  无法截图: 'screenshot-error',
  抓图搜图失败OpenCV: 'opencv-error',
  未解压运行软件: 'unzip-error',
  频繁应用保存: 'save-error',

  项目总体架构: 'architecture',
  主程序入口: 'entry',
  核心模块Main: 'core-main',
  GUI模块Gui: 'gui',
  线程WorkerThread: 'thread-worker',
  插件Plugins: 'plugins',
  国际化Lang: 'i18n',
  其他资源目录: 'resources',
  新指令添加流程以开源指令OpenSource为例: 'add-command',
  Debug运行测试: 'debug',
  用户界面模块: 'ui-module',
  数据结构模块: 'data-structure',
  宏编辑界面模块: 'macro-editor',
  热键与宏指令处理模块: 'hotkey',
  资源处理模块: 'resource',
};

// 去掉 emoji / 标点 / 前导序号，得到映射用的 key
function toKey(title) {
  return title
    .replace(/`/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '')
    .replace(/^\d+/, '');
}

// 侧边栏显示的标题：去掉 markdown 的 #，保留 emoji 和序号
function toDisplay(title) {
  return title.replace(/^#+\s*/, '').trim();
}

// 发布包源 md 里残留的固定笔误，转换时统一修正。
// 源文件不动，这样重导也不会再把错字带回来。
const TEXT_FIXES = [
  ['识别的的文本', '识别的文本'],
  ['PresssKeyUtil', 'PressKeyUtil'],
  ['WrokGlobalUtil', 'WorkGlobalUtil'],
  ['向下下入分支', '向下插入分支'],
  ['结果真的分支指令', '结果为真的分支指令'],
  ['不会改成变量原本的值', '不会改变变量原本的值'],
  ['勾上了取消保存在重新勾选', '勾上了取消保存，再重新勾选'],
  ['否则手柄功能无法生效」。', '否则手柄功能无法生效。'],
  ['自上而下执行满意第一个条件', '自上而下执行满足第一个条件'],
  ['若上诉操作均未解决', '若上述操作均未解决'],
  ['这是Window的安全机制', '这是 Windows 的安全机制'],
  ['实时获取当前鼠标X"', '实时获取当前鼠标X'],
  ['实时获取当前鼠标Y"', '实时获取当前鼠标Y'],
];

function proofread(text) {
  for (const [from, to] of TEXT_FIXES) text = text.split(from).join(to);
  return text;
}

// MDX 会把裸 {xxx} 当表达式解析并报错，代码之外的 { 要转义
function escapeBraces(text) {
  const parts = text.split('```');
  for (let i = 0; i < parts.length; i += 2) {
    parts[i] = parts[i].replace(/(`[^`\n]+`)|(\{)/g, (m, code, brace) =>
      code ? code : '\\{',
    );
  }
  return parts.join('```');
}

// 表格单元格里的 <br> 在 MDX 里会被要求闭合，统一写成 <br/>
function selfCloseBr(text) {
  return text.replace(/<br\s*>/gi, '<br/>');
}

function fixMdx(text) {
  return selfCloseBr(escapeBraces(text));
}

function writePage(file, title, body, position) {
  const fm = [
    '---',
    `title: ${JSON.stringify(title)}`,
    `sidebar_position: ${position}`,
    '---',
    '',
  ].join('\n');
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, fm + body.trim() + '\n', 'utf8');
}

function cleanDir(dir) {
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) continue;
    if (/\.(md|mdx)$/.test(f)) fs.rmSync(p);
  }
}

function copyDir(from, to) {
  fs.mkdirSync(to, {recursive: true});
  for (const entry of fs.readdirSync(from, {withFileTypes: true})) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else fs.copyFileSync(src, dst);
  }
}

let total = 0;
for (const t of TARGETS) {
  const srcRel = t.srcs.find((s) => fs.existsSync(path.join(ROOT, s)));
  const outDir = path.join(ROOT, t.out);
  if (!srcRel) {
    console.log(`跳过（源不存在）：${t.srcs.join(' / ')}`);
    continue;
  }
  const srcDir = path.join(ROOT, srcRel);

  // 图片
  const imgSrc = path.join(srcDir, 'Images');
  if (fs.existsSync(imgSrc)) {
    copyDir(imgSrc, path.join(ROOT, 'static/img', t.img));
  }

  const sidebar = [];
  for (const f of FILES) {
    const srcFile = path.join(srcDir, f.file);
    if (!fs.existsSync(srcFile)) continue;

    let raw = fs.readFileSync(srcFile, 'utf8');
    raw = raw.replace(/\/RMT\/Web\/Images\//g, `/img/${t.img}/`);
    raw = proofread(raw);
    raw = fixMdx(raw);

    const groupDir = f.root ? path.join(ROOT, f.dir) : path.join(outDir, f.dir);
    cleanDir(groupDir);
    fs.mkdirSync(groupDir, {recursive: true});
    // 不随版本的页面（root）在项目根，没有分类概念，不写 _category_.json
    if (!f.root) {
      const cat = {label: f.label, position: f.position};
      // 单页分类让分类本身就是链接，避免侧边栏出现「分类 > 同名页面」两层
      if (f.split === false) cat.link = {type: 'doc', id: `${f.dir}/index`};
      fs.writeFileSync(
        path.join(groupDir, '_category_.json'),
        JSON.stringify(cat, null, 2) + '\n',
        'utf8',
      );
    }

    const items = [];
    if (f.split === false) {
      const lines = raw.split(/\r?\n/);
      const h1 = lines.find((l) => /^#\s/.test(l));
      const body = lines.filter((l) => !/^#\s/.test(l)).join('\n');
      const file = path.join(groupDir, 'index.mdx');
      writePage(file, toDisplay(h1 ?? f.label), body, 1);
      items.push(`${f.dir}/index`);
      total += 1;
    } else {
      // 按 "## " 切分，第一段（h1 + 导语）作为分组首页
      const chunks = raw.split(/^##\s/m);
      const head = chunks.shift() ?? '';
      const headLines = head.split(/\r?\n/);
      const h1 = headLines.find((l) => /^#\s/.test(l));
      const headBody = headLines.filter((l) => !/^#\s/.test(l)).join('\n');
      if (headBody.trim()) {
        writePage(
          path.join(groupDir, 'index.mdx'),
          toDisplay(h1 ?? f.label),
          headBody,
          1,
        );
        items.push(`${f.dir}/index`);
        total += 1;
      }

      chunks.forEach((chunk, i) => {
        const lines = chunk.split(/\r?\n/);
        const heading = lines.shift() ?? '';
        const key = toKey(heading);
        const slug = SLUGS[key] ?? key;
        if (!slug) return;
        writePage(
          path.join(groupDir, `${slug}.mdx`),
          toDisplay(heading),
          lines.join('\n'),
          i + 2,
        );
        items.push(`${f.dir}/${slug}`);
        total += 1;
      });
    }

    if (f.root) {
      // 不随版本的页面不进任何版本的侧边栏
      console.log(`  ${f.dir}/（不随版本）：${items.length} 页`);
    } else {
      sidebar.push({
        type: 'category',
        label: f.label,
        collapsed: true,
        items: items.map((id) => ({type: 'doc', id})),
      });
      console.log(`  ${t.out}/${f.dir}：${items.length} 页`);
    }
  }

  // 版本快照的侧边栏是写死的列表，得同步更新；docs/ 用 autogenerated，不用管
  if (t.out.startsWith('versioned_docs')) {
    const ver = path.basename(t.out).replace('version-', '');
    const sbFile = path.join(ROOT, 'versioned_sidebars', `version-${ver}-sidebars.json`);
    fs.mkdirSync(path.dirname(sbFile), {recursive: true});
    fs.writeFileSync(
      sbFile,
      JSON.stringify({rmtSidebar: [{type: 'doc', id: 'intro'}, ...sidebar]}, null, 2) + '\n',
      'utf8',
    );
  }
  console.log(`${t.out} 完成，图片 -> static/img/${t.img}`);
}

console.log(`共生成 ${total} 个页面`);
