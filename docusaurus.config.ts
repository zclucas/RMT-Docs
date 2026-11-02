import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';
import type {PluginOptions as SearchOptions} from '@easyops-cn/docusaurus-search-local';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
  title: 'RMT 文档',
  tagline: 'RMT 帮助文档，含最新版与历史版本',
  favicon: 'img/favicon.ico',

  // Future flags, see https://docusaurus.io/docs/api/docusaurus-config#future
  future: {
    v4: true, // Improve compatibility with the upcoming Docusaurus v4
    faster: true,
  },

  // Set the production url of your site here
  url: 'https://your-docusaurus-site.example.com',
  // Set the /<baseUrl>/ pathname under which your site is served
  // For GitHub pages deployment, it is often '/<projectName>/'
  baseUrl: '/',

  onBrokenLinks: 'warn',

  i18n: {
    defaultLocale: 'zh-Hans',
    locales: ['zh-Hans'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          // 正式版 1.2.2 放在网站根路径。1.3 是测试版，从 /1.3/ 进入。
          // 历史版本会自动以 /<版本号>/ 为前缀，不再额外包含 /docs/。
          routeBasePath: '/',
          lastVersion: '1.2.2',
          versions: {
            current: {
              label: '最新版',
            },
            '1.3': {
              label: '1.3 测试版',
            },
          },
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  // 更新日志不随版本走：单独一个 docs 实例，全站只有一份，不进版本下拉。
  // 版本化只作用于上面的 preset docs，不会碰这个实例；离线包也不含它
  // （见 docusaurus.offline.config.ts 里的插件过滤）。
  plugins: [
    [
      '@docusaurus/plugin-content-docs',
      {
        id: 'changelog',
        path: 'changelog',
        routeBasePath: 'changelog',
        // 单页文档，不需要侧边栏
        sidebarPath: false,
      },
    ],
  ],

  // 全局搜索：纯本地离线索引，中文用 jieba 分词，多版本文档一起索引
  // 选项见 https://github.com/easyops-cn/docusaurus-search-local
  themes: [
    [
      require.resolve('@easyops-cn/docusaurus-search-local'),
      {
        // 中文分词（内置 @node-rs/jieba），英文一并支持
        language: ['zh', 'en'],
        indexDocs: true,
        indexBlog: false,
        // / 是各版本文档，/changelog 是不分版本的更新日志
        docsRouteBasePath: ['/', '/changelog'],
        // 结果里显示所属版本/路径
        explicitSearchResultPath: true,
        highlightSearchTermsOnTargetPage: true,
        searchResultLimits: 10,
        searchResultContextMaxLength: 40,
        hashed: true,
        ignoreFiles: [/llms[^/]*\.txt$/],
      } satisfies SearchOptions,
    ],
  ],

  themeConfig: {
    image: 'img/docusaurus-social-card.jpg',
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'RMT 文档',
      logo: {
        alt: 'RMT Logo',
        src: 'img/rmt-logo.png',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'rmtSidebar',
          position: 'left',
          label: '使用文档',
        },
        {
          to: '/changelog/',
          label: '更新日志',
          position: 'left',
        },
        {
          // 独立静态页面，不参与使用文档的版本化。
          // pathname:// 强制使用普通页面跳转，避免 SPA 路由接管静态页面。
          href: 'pathname:///supporters/',
          target: '_blank',
          html: '支持者星空',
          position: 'left',
        },
        {
          type: 'docsVersionDropdown',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: '文档',
          items: [
            {
              label: '使用文档',
              to: '/',
            },
            {
              label: '指令手册',
              to: '/commands/',
            },
            {
              label: '常见问题',
              to: '/faq/',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} RMT. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
