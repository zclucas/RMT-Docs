// Markdown 结构保护。
//
// 技术要求文档里代码块、行内代码、链接目标、JSX 标签一旦被改写，站点直接坏掉，
// 所以翻译前先把这些"不可翻"片段换成私用区占位符，翻完再换回来。
// 占位符用 \uE000 / \uE001 包围数字：私用区字符模型不会主动输出，
// 且不会和正文里的任何 Markdown 语法冲突。

const OPEN = '\uE000';
const CLOSE = '\uE001';

export function parseFrontMatter(raw) {
  const text = raw.replace(/^\uFEFF/, '');
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return {frontMatter: null, body: text};
  return {frontMatter: match[1], body: text.slice(match[0].length)};
}

// 只翻 title / sidebar_label / description 这类纯文本字段。
// 其余字段（slug、sidebar_position、id、tags、draft…）是路由和构建的输入，动了就出错。
const TRANSLATABLE_FM_KEYS = new Set(['title', 'sidebar_label', 'description']);

// 抽出需要翻译的字段（保持原文顺序，后续按同一顺序回填译文）
export function collectFrontMatterValues(frontMatter) {
  if (!frontMatter) return [];
  const items = [];
  frontMatter.split(/\r?\n/).forEach((line, lineIndex) => {
    const match = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line);
    if (!match) return;
    const [, key, rawValue] = match;
    if (!TRANSLATABLE_FM_KEYS.has(key)) return;
    const quoted = /^(['"])([\s\S]*)\1$/.exec(rawValue);
    const value = quoted ? quoted[2] : rawValue;
    if (!value.trim()) return;
    items.push({lineIndex, key, quote: quoted ? quoted[1] : '', value});
  });
  return items;
}

// 把译文按顺序写回原行，引号形态保持不变，避免 YAML 解析行为变化
export function applyFrontMatterTranslations(frontMatter, items, translatedValues) {
  if (!frontMatter || !items.length) return frontMatter;
  const lines = frontMatter.split(/\r?\n/);
  items.forEach((item, index) => {
    const translated = translatedValues[index];
    if (typeof translated !== 'string' || !translated.trim()) return;
    const value = item.quote ? `${item.quote}${translated}${item.quote}` : translated;
    lines[item.lineIndex] = `${item.key}: ${value}`;
  });
  return lines.join('\n');
}

// 保护不可翻片段。顺序重要：围栏代码先整体吞掉，后面的规则才碰不到它内部的语法。
export function protect(text) {
  const store = [];
  const keep = (snippet) => {
    store.push(snippet);
    return `${OPEN}${store.length - 1}${CLOSE}`;
  };

  const protectedText = text
    .replace(/^([ \t]*)(```|~~~)[\s\S]*?^\1\2[^\n]*$/gm, (m) => keep(m))
    .replace(/`[^`\n]+`/g, (m) => keep(m))
    // 链接 / 图片的目标部分：(url "title") 整体保留，只让方括号里的文字参与翻译
    .replace(/\]\([^)\n]*\)/g, (m) => keep(m))
    // HTML / JSX 标签、MDX 表达式
    .replace(/<\/?[A-Za-z][^>\n]*>/g, (m) => keep(m))
    .replace(/\{[^{}\n]*\}/g, (m) => keep(m));

  return {text: protectedText, store};
}

export function restore(text, store) {
  return text.replace(
    new RegExp(`${OPEN}\\s*(\\d+)\\s*${CLOSE}`, 'g'),
    (whole, index) => store[Number(index)] ?? whole,
  );
}

// 保护后按空行切块。代码围栏此时已经是单行占位符，不会被拦腰截断。
export function splitBlocks(protectedText) {
  return protectedText
    .split(/\r?\n[ \t]*\r?\n/)
    .map((block) => block.trim())
    .filter(Boolean);
}

// 把若干块拼成一次请求的载荷。块之间用显式分隔符，模型被要求原样保留，
// 回来后按分隔符切分，段落数量不会因为模型"合并同类项"而错位。
const SPLIT_TOKEN = '⟦RMT§BLOCK⟧';

export function buildBatch(blocks) {
  return blocks.map((block) => `${SPLIT_TOKEN}\n${block}`).join('\n\n');
}

export function parseBatch(translated, expected) {
  const parts = translated
    .split(SPLIT_TOKEN)
    .map((part) => part.replace(/^\s*\n?/, '').trim())
    .filter((part, index) => index > 0 || part.length > 0);

  // 分隔符被模型吃掉时不做缝合（宁可整块回退原文，也不把内容拼错）
  if (parts.length !== expected) return null;
  return parts;
}

export {SPLIT_TOKEN};
