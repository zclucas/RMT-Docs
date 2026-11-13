// 离线包（file://）的搜索框 UI。
//
// 索引由 plugins/offline-search 在构建时写成 window.__RMT_SEARCH__。
// 这里全部用原生 DOM，不碰 React —— 避免和 Docusaurus 的重渲染互相打架，
// 也不需要 swizzle 任何主题组件，插件升级影响不到这份代码。
//
// 匹配策略：中文直接做子串匹配（不引 jieba / lunr，中文分词对文档站收益不大），
// 多个关键词之间是 AND 关系，标题 > 小标题 > 正文。
(function () {
  'use strict';

  var DATA = window.__RMT_SEARCH__;

  // 多语言：按当前路由的语言前缀挑索引桶。
  // 离线包走 hash 路由，地址形如 #/en/guide/x，第一段就是语言代码；
  // 切语言不刷新页面，所以每次搜索都重新取一次，不能缓存成常量。
  function currentBucket() {
    if (DATA && DATA.locales) {
      var hash = (window.location.hash || '').replace(/^#\/?/, '');
      var code = hash.split('/')[0];
      return DATA.locales[code] || DATA.locales[DATA.defaultLocale] || null;
    }
    // 兼容旧的单语言索引形状（{version, docs}）
    return DATA && DATA.docs && DATA.docs.length
      ? {docs: DATA.docs, version: DATA.version}
      : null;
  }

  var BUCKET = currentBucket();
  if (!BUCKET || !BUCKET.docs || !BUCKET.docs.length) return;
  var MAX_RESULTS = 12;
  var SNIPPET_PAD = 44;

  // 输入框直接套主题自带的 .navbar__search-input（外观、放大镜图标、移动端
  // 自动缩窄到 9rem 都是现成的），这里只写包裹层和结果面板。
  var CSS = [
    '.rmt-search{position:relative;display:flex;align-items:center;margin-left:.75rem;min-width:0;flex:none}',
    '.rmt-search__panel{position:absolute;top:calc(100% + .5rem);right:0;width:390px;max-width:88vw;',
    'max-height:65vh;overflow-y:auto;z-index:400;padding:.3rem;display:none;',
    'background:var(--ifm-background-surface-color);border:1px solid var(--ifm-color-emphasis-300);',
    'border-radius:var(--ifm-global-radius);box-shadow:var(--ifm-global-shadow-md)}',
    '.rmt-search__panel.is-open{display:block}',
    '.rmt-search__hit{display:block;padding:.5rem .6rem;border-radius:var(--ifm-global-radius);',
    'color:var(--ifm-font-color-base);text-decoration:none;cursor:pointer}',
    '.rmt-search__hit:hover,.rmt-search__hit.is-active{background:var(--ifm-hover-overlay);text-decoration:none}',
    '.rmt-search__hit-title{font-weight:600;font-size:.9rem;line-height:1.5}',
    '.rmt-search__hit-meta{font-size:.72rem;color:var(--ifm-color-emphasis-600);margin-top:.1rem}',
    '.rmt-search__hit-snippet{font-size:.78rem;color:var(--ifm-color-emphasis-700);margin-top:.25rem;line-height:1.6}',
    '.rmt-search__empty,.rmt-search__tip{padding:.6rem;font-size:.78rem;color:var(--ifm-color-emphasis-600)}',
    '.rmt-search mark{background:rgba(74,108,247,.22);color:inherit;padding:0 2px;border-radius:2px}',
    '.rmt-search__kbd{float:right;font-size:.7rem;color:var(--ifm-color-emphasis-500);padding-top:.15rem}',
  ].join('');

  // ---------- 工具 ----------

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function lower(s) {
    return String(s || '').toLowerCase();
  }

  function countOccurrences(haystack, needle) {
    var n = 0;
    var from = 0;
    for (;;) {
      var at = haystack.indexOf(needle, from);
      if (at === -1) return n;
      n += 1;
      from = at + needle.length;
      if (n > 40) return n;
    }
  }

  function highlight(text, terms) {
    var out = escapeHtml(text);
    for (var i = 0; i < terms.length; i++) {
      var term = terms[i];
      if (!term) continue;
      out = out.replace(
        new RegExp(escapeRegExp(escapeHtml(term)), 'gi'),
        function (m) {
          return '<mark>' + m + '</mark>';
        },
      );
    }
    return out;
  }

  // ---------- 检索 ----------

  function makeSnippet(body, terms) {
    var haystack = lower(body);
    var at = -1;
    for (var i = 0; i < terms.length; i++) {
      var found = haystack.indexOf(terms[i]);
      if (found !== -1 && (at === -1 || found < at)) at = found;
    }
    if (at === -1) {
      return body.length > SNIPPET_PAD * 2 ? body.slice(0, SNIPPET_PAD * 2) + '…' : body;
    }
    var start = Math.max(0, at - SNIPPET_PAD);
    var end = Math.min(body.length, at + SNIPPET_PAD);
    return (start > 0 ? '…' : '') + body.slice(start, end) + (end < body.length ? '…' : '');
  }

  // 命中的小标题：用来在跳转后滚到对应位置（按文字找，不依赖 heading id）
  function matchHeading(doc, terms) {
    var headings = doc.h || [];
    for (var i = 0; i < terms.length; i++) {
      for (var j = 0; j < headings.length; j++) {
        if (lower(headings[j]).indexOf(terms[i]) !== -1) return headings[j];
      }
    }
    return '';
  }

  function search(query) {
    var terms = lower(query).split(/\s+/).filter(function (t) {
      return t.length > 0;
    });
    if (!terms.length) return [];

    var bucket = currentBucket() || BUCKET;
    var docs = bucket.docs || [];

    var hits = [];
    for (var i = 0; i < docs.length; i++) {
      var doc = docs[i];
      var title = lower(doc.t);
      var headings = lower((doc.h || []).join(' '));
      var body = lower(doc.b);
      var score = 0;
      var matchedAll = true;

      for (var j = 0; j < terms.length; j++) {
        var term = terms[j];
        var termScore = 0;
        var titleAt = title.indexOf(term);
        if (titleAt === 0 && title.length === term.length) termScore += 60;
        else if (titleAt === 0) termScore += 30;
        else if (titleAt !== -1) termScore += 16;
        if (headings.indexOf(term) !== -1) termScore += 7;
        var bodyCount = body ? countOccurrences(body, term) : 0;
        if (bodyCount) termScore += 1 + Math.min(bodyCount, 6) * 0.4;
        if (!termScore) {
          matchedAll = false;
          break;
        }
        score += termScore;
      }

      if (matchedAll) hits.push({doc: doc, score: score});
    }

    hits.sort(function (a, b) {
      return b.score - a.score;
    });
    return hits.slice(0, MAX_RESULTS).map(function (hit) {
      return {
        doc: hit.doc,
        title: hit.doc.t,
        category: hit.doc.c,
        snippet: makeSnippet(hit.doc.b, terms),
        heading: matchHeading(hit.doc, terms),
      };
    });
  }

  // ---------- 跳转 ----------

  // 站内链接走 hash 路由：#/xxx
  function permalinkHash(permalink) {
    return '#' + (permalink || '/');
  }

  var pendingHeading = '';

  function scrollToHeading() {
    if (!pendingHeading) return;
    var wanted = lower(pendingHeading);
    var deadline = Date.now() + 3000;
    (function attempt() {
      var nodes = document.querySelectorAll(
        'article h2, article h3, article h4, article h5, .markdown h2, .markdown h3, .markdown h4, .markdown h5',
      );
      for (var i = 0; i < nodes.length; i++) {
        if (lower(nodes[i].textContent).indexOf(wanted) === 0) {
          nodes[i].scrollIntoView({block: 'start'});
          pendingHeading = '';
          return;
        }
      }
      if (Date.now() < deadline) setTimeout(attempt, 120);
      else pendingHeading = '';
    })();
  }

  function goTo(result) {
    pendingHeading = result.heading || '';
    var target = permalinkHash(result.doc.p);
    closePanel();
    input.blur();
    if (window.location.hash === target) {
      // 已经在同一页，hash 不变不会触发路由，直接滚到小标题
      scrollToHeading();
      return;
    }
    window.location.hash = target;
    setTimeout(scrollToHeading, 60);
  }

  // ---------- UI ----------

  var style = document.createElement('style');
  style.textContent = CSS;
  (document.head || document.documentElement).appendChild(style);

  var root = document.createElement('div');
  root.className = 'rmt-search';
  root.setAttribute('role', 'search');

  var input = document.createElement('input');
  input.className = 'navbar__search-input';
  input.type = 'search';
  input.placeholder = '搜索文档';
  input.setAttribute('aria-label', '搜索文档');
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('spellcheck', 'false');

  var panel = document.createElement('div');
  panel.className = 'rmt-search__panel';

  root.appendChild(input);
  root.appendChild(panel);

  var results = [];
  var activeIndex = -1;
  var versionTip = BUCKET.version ? '离线版 ' + BUCKET.version : '离线版';

  function openPanel() {
    panel.classList.add('is-open');
  }

  function closePanel() {
    panel.classList.remove('is-open');
    activeIndex = -1;
  }

  function render(html) {
    panel.innerHTML = html;
    openPanel();
  }

  function renderHits(query) {
    results = search(query);
    activeIndex = -1;

    if (!results.length) {
      render('<div class="rmt-search__empty">没有找到「' + escapeHtml(query) + '」</div>');
      return;
    }

    var terms = lower(query).split(/\s+/).filter(Boolean);
    var html = '';
    for (var i = 0; i < results.length; i++) {
      var hit = results[i];
      var meta = [];
      if (hit.category) meta.push(hit.category);
      if (hit.heading) meta.push(hit.heading);
      html +=
        '<a class="rmt-search__hit" data-index="' + i + '" href="' + escapeHtml(permalinkHash(hit.doc.p)) + '">' +
        '<div class="rmt-search__hit-title">' + highlight(hit.title, terms) + '</div>' +
        (meta.length ? '<div class="rmt-search__hit-meta">' + highlight(meta.join(' › '), terms) + '</div>' : '') +
        '<div class="rmt-search__hit-snippet">' + highlight(hit.snippet, terms) + '</div>' +
        '</a>';
    }
    html += '<div class="rmt-search__tip">' + results.length + ' 条结果 · ↑↓ 选择 · 回车打开 · Esc 关闭</div>';
    html += '<div class="rmt-search__kbd">' + escapeHtml(versionTip) + '</div>';
    render(html);
  }

  function setActive(index) {
    var nodes = panel.querySelectorAll('.rmt-search__hit');
    if (!nodes.length) return;
    if (index < 0) index = nodes.length - 1;
    if (index >= nodes.length) index = 0;
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].classList.toggle('is-active', i === index);
    }
    activeIndex = index;
    if (nodes[index].scrollIntoView) nodes[index].scrollIntoView({block: 'nearest'});
  }

  var debounceTimer = null;

  input.addEventListener('input', function () {
    var value = input.value.trim();
    if (debounceTimer) clearTimeout(debounceTimer);
    if (!value) {
      results = [];
      closePanel();
      return;
    }
    debounceTimer = setTimeout(function () {
      renderHits(value);
    }, 120);
  });

  input.addEventListener('focus', function () {
    if (input.value.trim() && panel.innerHTML) openPanel();
  });

  input.addEventListener('keydown', function (event) {
    var key = event.key;
    if (key === 'ArrowDown') {
      event.preventDefault();
      if (!panel.classList.contains('is-open')) {
        if (input.value.trim()) renderHits(input.value.trim());
        return;
      }
      setActive(activeIndex + 1);
      return;
    }
    if (key === 'ArrowUp') {
      event.preventDefault();
      setActive(activeIndex - 1);
      return;
    }
    if (key === 'Enter') {
      if (activeIndex >= 0 && results[activeIndex]) {
        event.preventDefault();
        goTo(results[activeIndex]);
      }
      return;
    }
    if (key === 'Escape') {
      closePanel();
      input.blur();
    }
  });

  panel.addEventListener('click', function (event) {
    var hit = event.target.closest ? event.target.closest('.rmt-search__hit') : null;
    if (!hit) return;
    event.preventDefault();
    var index = Number(hit.getAttribute('data-index'));
    if (results[index]) goTo(results[index]);
  });

  document.addEventListener('click', function (event) {
    if (!root.contains(event.target)) closePanel();
  });

  // ---------- 挂载 ----------

  function mount() {
    if (document.body && document.body.contains(root)) return true;
    var host =
      document.querySelector('.navbar__items--right') ||
      document.querySelector('.navbar__items') ||
      document.querySelector('.navbar__inner');
    if (!host) return false;
    host.insertBefore(root, host.firstChild);
    return true;
  }

  var attempts = 0;
  (function waitForNavbar() {
    if (mount()) {
      // React 重渲染可能把注入的节点丢掉，发现没了就补回来
      if (window.MutationObserver) {
        new MutationObserver(function () {
          if (document.body && !document.body.contains(root)) mount();
        }).observe(document.body, {childList: true, subtree: true});
      }
      return;
    }
    attempts += 1;
    if (attempts < 80) setTimeout(waitForNavbar, 100);
  })();
})();
