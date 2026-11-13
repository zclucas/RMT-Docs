# RMT 文档站

基于 Docusaurus 3，存放 RMT（若梦兔）各版本的帮助文档。在线站点含全部历史版本，离线版打包进 RMT 客户端。

## 常用命令

```bash
npm install                    # 安装依赖
npm run start                  # 本地开发
npm run build                  # 构建到 build/
npm run serve                  # 预览构建结果
npm run docs:version 1.3.0     # 把当前 docs/ 快照为新版本
npm run build:offline          # 离线版，默认取最新已发布版
```

## 目录

| 路径 | 用途 |
| --- | --- |
| `docs/` | 跟随开发的内容，版本下拉显示为「最新版」 |
| `versioned_docs/version-1.2.2/` | 当前正式版，网站默认打开这一版 |
| `versioned_docs/version-1.3/` | 1.3 测试版 |
| `versioned_docs/version-1.1.2/` | v1.1.2 快照 |
| `changelog/` | 更新日志，独立 docs 实例，不分版本 |
| `static/img/latest/`、`static/img/<版本>/` | 各版本配图 |
| `scripts/convert-web.mjs` | 发布包 `Web/` 导入脚本 |
| `tools/build_offline.mjs` | 离线版构建入口 |
| `tools/i18n/` | 多语言：翻译流水线、缺译检查、离线译文准备 |
| `locales.json` | 语言清单，全站唯一事实来源 |
| `plugins/offline-search/` | 离线版本地搜索 |

## 写文档

往分组目录里丢 `.md` / `.mdx` 就会自动进侧边栏，不用改 `sidebars.ts`。分组用英文目录名（URL 干净），中文名写在 `_category_.json` 里：

```
docs/
  intro.mdx            首页
  guide/               软件介绍
  quickstart/          快速上手
  commands/            指令手册
  cli/                 命令行
  ui-bind/             界面宏字段绑定
  faq/                 常见问题
  errors/              常见报错
  dev/                 开发指南
```

篇内用 front matter 控制标题与排序：

```md
---
title: 搜索图片
sidebar_position: 3
---
```

图片写 `/img/latest/MacroCMD/Key.png` 这样的绝对路径。

两个例外：

- **更新日志不放 `docs/`**。它由 `docusaurus.config.ts` 里独立的 docs 实例承载（`id: 'changelog'`、`routeBasePath: /changelog`），全站一份、不随版本快照走、导航栏单独入口，离线包也不含（`docusaurus.offline.config.ts` 会过滤掉这个实例）。
- **开发指南不拆页**。`dev/index.mdx` 一篇就是全部，转写脚本里设了 `split: false`，标题层级沿用源文档。单页分类的 `_category_.json` 带 `link`、版本快照在 `versioned_sidebars` 里写成单个 `doc` 项，侧边栏点分类名直接打开，不会多出一层。

## 从发布包的 `Web/` 目录导入

新版本发布后，把发布包里的 `Web/`（含 `软件介绍.md`、`指令手册.md` 等与 `Images/`）拷到 `versioned_docs/version-<版本号>/Web/`，在 `scripts/convert-web.mjs` 的 `TARGETS` 里加一条，然后：

```bash
node scripts/convert-web.mjs
```

脚本做三件事：按 `## 章节` 拆页、把 `Images/` 拷到 `static/img/<版本>/` 并把正文里的 `/RMT/Web/Images/` 改成 `/img/<版本>/`、生成 `_category_.json` 与 `versioned_sidebars`。

- 章节英文文件名写在 `SLUGS` 表里，没写到的直接拿中文标题当文件名。
- 源 md 的固定笔误（`PresssKeyUtil`、`WrokGlobalUtil`、「识别的的文本」等）由 `TEXT_FIXES` 表统一改掉，**源文件不用动**，重导不会把错字带回来。新发现笔误往表里加一行即可。
- 脚本只管「转换 + 去笔误」。之前对成稿做过的整理（统一标题层级、清理页尾残留 `---`、补分类首页导览、`variable-extract` 的引号/表格重写）不在脚本里，**重导后需要重跑整理流程**。

## 发一个新版本

```bash
git tag v1.4.0 && git push origin v1.4.0
```

`docs-release.yml` 快照 `docs/` 到 `versioned_docs/version-1.4.0/`，改 `versions.json` 和 `lastVersion`，过 typecheck + 在线构建 + 离线构建后提交 main，CF Pages 自动发布。

- tag 必须在 main 顶端，否则失败。
- 快照是 tag 之后的下一个提交，`git checkout v1.4.0` 里没有新版本目录。
- 只本地快照：`npm run docs:version 1.4.0`，`lastVersion` 手动改。

## 离线版（打包进 RMT）

```bash
npm run build:offline              # 最新已发布版本
npm run build:offline -- 1.1.2     # 指定版本
npm run build:offline:next         # docs/，未发布的开发版
```

产物在 `build-offline/`。把它里面的**内容**复制到主仓库 `rmt\Web\`（`index.html` 必须在 `Web\` 根，和 `Web\*.md` 源同级），`PackRMT.ps1` 的 `Copy-HelpDocs` 会把整个 `Web\` 复制进 `Release\Web`。注意 `Main\SelfCheck.ahk` 把 `Web\index.html` 列为**必需文件**，缺了自检不通过。

实现要点：

- 能用 `file://` 双击打开，靠官方 hash 路由（`future.experimental_router: 'hash'`）：关掉 SSG、只产出一个 `index.html`、路由走 `/#/xxx`。配置见 `docusaurus.offline.config.ts`。
- 自带一套本地搜索（`plugins/offline-search/`）：索引在构建时写成普通 `<script src>` 加载的全局变量，不 fetch、不起 Web Worker，`file://` 下可用。在线那套插件在离线配置里被换掉。
- **不含更新日志**，`/changelog` 只在在线站点提供。

## 多语言

框架已经搭好，默认只启用中文。**加一门语言不需要改代码**，只动 `locales.json`：

```bash
npm run i18n:add -- en "English"          # 写进 locales.json + 生成文案骨架
npm run i18n:sync -- --locale en          # 调模型翻译
npm run build                             # 产出 /（中文）和 /en/（英文）
```

`locales.json` 里每一项就是一门语言，第一项由 `defaultLocale` 指定为内容源语言。配置、翻译脚本、离线构建、CI 读的都是这一份文件，没有任何地方写死语言代码。

### 接哪个模型

不绑定平台，靠环境变量描述端点。默认走 OpenAI 兼容协议，DeepSeek、通义、Kimi、OpenRouter、Ollama、vLLM 都是改个 `AI_BASE_URL` 的事：

```bash
AI_BASE_URL=https://api.deepseek.com/v1
AI_API_KEY=sk-...
AI_MODEL=deepseek-chat
```

Anthropic 原生：`AI_PROVIDER=anthropic`（`AI_MODEL` 缺省 `claude-sonnet-4-5`）。
要接别的协议：`AI_PROVIDER=custom` + `AI_MODULE=./my-provider.mjs`，模块导出 `translate({system, user})` 即可。

本地开发把这几个变量写进 `.env.local` 再 `export`，或直接前缀在命令行上；CI 走仓库 Variables + Secrets（见下）。

### 翻译流水线做了什么

- **结构保护**：代码块、行内代码、链接地址、图片路径、JSX 标签先换成占位符，翻完再换回来。技术文档里这些被改写，站点会直接坏。
- **只翻该翻的**：front matter 只动 `title` / `sidebar_label` / `description`，`slug`、`sidebar_position` 这类构建输入一律不碰。
- **增量**：`.i18n-cache.json` 记录每篇源文档哈希，源没变就不重复调模型。**这个文件要提交进仓库**，CI 才能接着上一轮跑。
- **版本策略**：默认只翻 `current` 和最新一个已发布版本，历史快照不动（`--all-versions` 可全量）。
- **术语表**：`tools/i18n/glossary.json` 的 `keep` 原样保留，`preferred` 固定译法，保证「界面宏」「按键宏」这类词全站一致。

### 离线包

离线包也会带译文，但它的版本名和在线站对不上：离线构建关了版本化，Docusaurus 只认 `current`，而已发布版本的译文在 `version-1.2.2/` 下。所以 `npm run build:offline` 会先调 `tools/i18n/prepare-offline.mjs` 生成临时目录 `.i18n-offline/`，把目标版本译文映射成 `current`，再让 `i18n.path` 指过去——仓库里的 `i18n/` 不会被改动。

不想让某门语言进离线包（文档正文会打进 JS bundle，体积翻倍）就在 `locales.json` 里给它加 `"offline": false`。

离线搜索按语言分了索引：`window.__RMT_SEARCH__.locales[<code>]`，UI 按当前 hash 前缀选桶，切语言后搜索结果跟着换。

### CI

`.github/workflows/i18n.yml`：

- **PR**：只跑 `i18n:check`，把缺失/过期清单写进 job summary 并上传 artifact，不改文件。
- **push main**：自动翻译变更文档，把译文提交回 main。没配 `AI_API_KEY` / `AI_BASE_URL` 就跳过，流水线保持绿色。

在仓库 Settings → Secrets and variables → Actions 里配：`AI_API_KEY`（Secret）、`AI_BASE_URL` / `AI_MODEL` / `AI_PROVIDER`（Variables）。

### 需要留意的地方

- 首页就是 `docs/intro.mdx`（`routeBasePath: '/'`），英文站 `/en/` 的首页同样取这篇的译文，它没翻的话打开是中文。
- 离线包走 hash 路由，语言切换链接形如 `#/en/...`。这块是主题自带组件的行为，**首次开启多语言后建议用 `file://` 实际点一遍切换器**。
- 在线搜索多语言下每门语言一份索引，`docsRouteBasePath` 在非默认语言下是否要带前缀，开启语言后跑一次 `build` 确认。
- 站点文案（导航、页脚、侧边栏分类）在 `i18n/<locale>/docusaurus-theme-classic/*.json` 和 `.../docusaurus-plugin-content-docs/*.json`，由 `write-translations` 生成，`i18n:sync` 负责翻译其中的中文条目。

## 搜索

用 `@easyops-cn/docusaurus-search-local`，纯本地索引、不依赖 Algolia，中文走 jieba 分词，配置在 `docusaurus.config.ts` 的 `themes` 段。

**索引只在 `npm run build` 时生成**，`npm run start` 下搜索框点开没有结果，要看效果必须 `npm run build && npm run serve`。索引产物：`build/search-index.json`（当前版本）、`build/<版本>/search-index.json`（历史版本），即浏览哪个版本就搜哪个版本。

## 其他

- 在线文档部署在域名根路径：默认发布版本的入口是 `/`，例如 `/commands/`；其他历史版本是 `/<版本号>/`，例如 `/1.1.2/commands/`，开发中的「最新版」是 `/next/`。因此配置 `https://docs.ruomengtu.com` 后，无需保留 `/docs/`。
- `npm run start` 返回的是客户端渲染空壳，直接刷新 `/commands/...` 这类子路由会 404，写文档从根路径进入、或直接用 `build + serve` 预览。
- 站点标题、导航、页脚在 `docusaurus.config.ts`，主题色在 `src/css/custom.css`。
- `blog` 已关闭，更新日志不走 blog。
- `_demo-template/` 用于归档模板示例、原始 `Web/` 源和调试日志，不参与构建，已在 `.gitignore` 里，确认不需要可删。
