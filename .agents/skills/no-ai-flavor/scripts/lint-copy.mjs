#!/usr/bin/env node
// 去 AI 味检查：扫描文件或目录里给人看的文字（HTML 文本和属性、JSX/Astro/Vue 里的文字和字符串、
// Markdown、JSON 字符串值），按 phrases.json 的词表和下面的句式规则报告。无依赖，Node 18+。
//
// node lint-copy.mjs [路径…] [--strict] [--lang zh,fr,en] [--allow 词1,词2] [--off 规则1,规则2] [--json] [--quiet]
//   不给路径时：有 dist 扫 dist，否则有 src 扫 src，否则扫当前目录。
//   error 出现即退出码 1；--strict 时 warn 也算失败。
//   项目根目录可放 .copylint.json：{ "allow": [], "ignore": ["路径片段"], "off": ["规则 id"],
//   "lang": ["zh","fr"], "phrases": { "zh": { "error": [], "warn": [] } } }

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname, dirname, resolve, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// ---------- 参数与配置 ----------
const argv = process.argv.slice(2);
const opt = { strict: false, json: false, quiet: false, lang: null, allow: [], off: [], paths: [] };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const val = () => (a.includes('=') ? a.slice(a.indexOf('=') + 1) : argv[++i]) ?? '';
  if (a === '--strict') opt.strict = true;
  else if (a === '--json') opt.json = true;
  else if (a === '--quiet') opt.quiet = true;
  else if (a.startsWith('--lang')) opt.lang = val().split(',').map((s) => s.trim()).filter(Boolean);
  else if (a.startsWith('--allow')) opt.allow.push(...val().split(',').map((s) => s.trim()).filter(Boolean));
  else if (a.startsWith('--off')) opt.off.push(...val().split(',').map((s) => s.trim()).filter(Boolean));
  else if (a === '-h' || a === '--help') { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 9).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(0); }
  else opt.paths.push(a);
}

const cfgPath = resolve('.copylint.json');
const cfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf8')) : {};
const langs = new Set(opt.lang ?? cfg.lang ?? ['zh', 'fr', 'en']);
const off = new Set([...(cfg.off ?? []), ...opt.off]);
const ignore = cfg.ignore ?? [];

const norm = (s) => s.normalize('NFC').replace(/[’‘]/g, "'").replace(/\u00a0/g, ' ');
const lists = JSON.parse(readFileSync(join(here, 'phrases.json'), 'utf8'));
const allow = [...(lists.allow ?? []), ...(cfg.allow ?? []), ...opt.allow].map((s) => norm(s).toLowerCase());

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const LATIN = 'a-z0-9à-ÿœæ';
const wordRules = [];
for (const lang of ['zh', 'fr', 'en']) {
  if (!langs.has(lang)) continue;
  for (const level of ['error', 'warn']) {
    const items = [...(lists[lang]?.[level] ?? []), ...(cfg.phrases?.[lang]?.[level] ?? [])];
    for (const raw of items) {
      const p = norm(raw).toLowerCase();
      let re;
      if (lang === 'zh') re = new RegExp(esc(p), 'g');
      else {
        const prefix = p.endsWith('*');
        const body = esc(prefix ? p.slice(0, -1) : p);
        const tail = prefix ? '' : `(?![${LATIN}])`;
        re = new RegExp(`(?<![${LATIN}])${body}${tail}`, 'g');
      }
      wordRules.push({ id: `${lang}.word`, level, re, phrase: raw });
    }
  }
}

// ---------- 句式规则 ----------
// scope: 'text' = 任意文字片段；'short' = 整个片段很短（标签、按钮、卡片描述）；'heading' = 标题片段
const CJK = '\\u4e00-\\u9fff';
const P = '[^。！？!?\\n]'; // 句内字符
// 形容性质的词：三段式只在至少两项是这类词时报（配料、导航这类真实列举不报）
const ZH_Q = '(?:更|很|超|最)[${CJK}]{1,2}|快速|简单|可靠|安全|高效|稳定|专业|贴心|省心|放心|便捷|轻松|透明|灵活|智能|极简|优雅|精准|实用|美观|清晰|好用|易用|快捷|准确|及时|真实|温暖|自然|纯粹|极致|专注|耐用|舒适|健康|新鲜|地道|正宗|靠谱|简洁|直观|强大|丰富|多元|开放|包容|创新|传统|现代|时尚|精致|独特|高端|大气|安心|省时|省力|省钱'.replace('${CJK}', CJK);
const LAT_Q = 'fast|simple|secure|reliable|easy|powerful|flexible|smart|modern|beautiful|elegant|clean|intuitive|seamless|scalable|robust|efficient|affordable|innovative|sustainable|timeless|authentic|bold|fresh|rapide|fiable|sécurisée?|efficace|élégante?|moderne|intuitive?|durable|authentique|chaleureuse?|conviviale?|innovante?|accessible|responsable|audacieuse?|raffinée?|généreuse?|qualité|réactivité|proximité|passion|innovation|excellence';
const structural = [
  { id: 'zh.not-but', lang: 'zh', level: 'error', re: new RegExp(`不是${P}{1,24}?[，,；;]?\\s*而是`, 'g'), msg: '「不是…而是…」：直接说后半句' },
  { id: 'zh.not-only', lang: 'zh', level: 'error', re: new RegExp(`(不仅仅?是?|不只是?|不单是?)${P}{1,24}?[，,；;]\\s*(更|还|也|而且)`, 'g'), msg: '「不仅…更…」：只说真正要说的那一半' },
  { id: 'zh.rather', lang: 'zh', level: 'error', re: new RegExp(`与其${P}{1,24}?[，,]?\\s*不如`, 'g'), msg: '「与其…不如…」' },
  { id: 'zh.steps3', lang: 'zh', level: 'error', re: /先[^，。；！？\n]{1,14}[，,、；]\s*再[^，。；！？\n]{1,14}[，,、；]\s*(最后|然后|最终)/g, msg: '「先…再…最后…」三段式（真的操作步骤除外）' },
  { id: 'zh.steps2', lang: 'zh', level: 'warn', re: /先[^，。；！？\n]{1,10}[，,、]\s*再[^，。；！？\n]{1,10}/g, msg: '「先…再…」：是操作说明就留，是口号就删', unless: 'zh.steps3' },
  { id: 'zh.make-better', lang: 'zh', level: 'error', re: /让[^，。！？\n]{1,12}?更(?!新|改|换|正|名|多)/g, msg: '「让…更…」承诺句' },
  { id: 'zh.just-need', lang: 'zh', level: 'error', re: /只需[^。！？\n]{0,16}?(即可|就能|就可以|便可|轻松)/g, msg: '「只需…即可…」' },
  { id: 'zh.every-deserves', lang: 'zh', level: 'error', re: /每一?(个|位|份|次|天|处|张|步|刻|种|件|段)[^。！？\n]{0,14}?(都|皆)值得/g, msg: '「每一个…都值得…」' },
  { id: 'zh.every-is', lang: 'zh', level: 'warn', re: /每一(个|位|份|次|天|处|张|步|刻|种|件|段)[^。！？\n]{0,6}[，,]\s*都(是|有|能|在)/g, msg: '「每一份…，都是…」' },
  { id: 'zh.time-opener', lang: 'zh', level: 'error', re: /(^|[。！？!?\n])\s*(今天|此刻|如今|当下|现在)[，,]/g, msg: '以「今天，」「现在，」开头' },
  { id: 'zh.colon-slogan', lang: 'zh', level: 'warn', scope: 'short', re: new RegExp(`^(?!第.{1,3}步|步骤)[^：:\\n]{2,12}[：:]\\s*(让|为|用|把|给|与)[^。\\n]{2,16}$`), msg: '冒号标语「X：让 Y…」' },
  { id: 'zh.short-pair', lang: 'zh', level: 'warn', scope: 'short', re: new RegExp(`^(?!已|未|待|正在|无|不)[${CJK}]{2,6}[，,](也|却|更|再|才|就|又|还|而|但|便|亦)[${CJK}]{1,6}[。.]?$`), msg: '逗号切开的两段口号（如「近义，也有不同」「先看见，再决定」）' },
  { id: 'zh.triad', lang: 'zh', level: 'warn', re: new RegExp(`(?:${ZH_Q})[、，,](?:${ZH_Q})[、，,和与及][${CJK}]{2,4}|[${CJK}]{2,4}[、，,](?:${ZH_Q})[、，,和与及](?:${ZH_Q})|(?:${ZH_Q})[、，,][${CJK}]{2,4}[、，,和与及](?:${ZH_Q})`, 'g'), msg: '三个并列的形容（如「快速、简单、可靠」）' },
  { id: 'zh.count-big', lang: 'zh', level: 'error', re: /[一二三四五六七八九十\d]+\s*大\s*(优势|亮点|理由|特色|特点|核心|好处|功能|保障|承诺|价值)/g, msg: '「三大优势」' },
  { id: 'zh.count', lang: 'zh', level: 'warn', re: /(?<![一-龥\d])([2-9]|\d{2,}|[二三四五六七八九十两]+)\s*(种|个|步)\s*(方式|方法|步骤|理由|亮点|技巧|秘诀|好处)/g, msg: '数数（用户看得见有几个）' },
  { id: 'zh.role', lang: 'zh', level: 'warn', re: /(扮演|发挥|起到|起着)(着|了)?[^。，\n]{0,10}(角色|作用)/g, msg: '「扮演…角色 / 发挥…作用」：用「是」「做」' },
  { id: 'zh.era', lang: 'zh', level: 'error', re: /(在这个[^。，\n]{1,12}的时代|随着[^。，\n]{1,16}的(发展|普及|进步|到来))/g, msg: '时代开场白' },
  { id: 'zh.fullwidth-exclaim', lang: 'zh', level: 'error', re: /！/g, msg: '感叹号' },

  { id: 'en.not-just', lang: 'en', level: 'error', re: /\bnot (just|only|merely|simply)\b[^.!?\n]{1,60}?\b(but|it'?s)\b/gi, msg: '"not just X but Y"' },
  { id: 'en.its-not', lang: 'en', level: 'error', re: /\b(it'?s|this is|that'?s|it is) not (about )?[^.!?\n]{1,40}?[,;.]\s*(it'?s|this is|that'?s|it is)\b/gi, msg: '"it\'s not X, it\'s Y"' },
  { id: 'fr.not-but', lang: 'fr', level: 'error', re: /\bce n'est pas\b[^.!?\n]{1,60}?[,;.]\s*c'est\b/gi, msg: '« ce n\'est pas X, c\'est Y »' },
  { id: 'fr.non-seulement', lang: 'fr', level: 'error', re: /\bnon seulement\b[^.!?\n]{1,60}?\bmais\b/gi, msg: '« non seulement… mais… »' },
  { id: 'latin.triad', lang: 'en', level: 'warn', re: new RegExp(`\\b(?:${LAT_Q}), (?:${LAT_Q}),? (?:(?:and|et|&) )?[\\p{L}'-]+|\\b[\\p{L}'-]+, (?:${LAT_Q}),? (?:(?:and|et|&) )?(?:${LAT_Q})\\b`, 'giu'), msg: 'triad "fast, simple, secure" / « rapide, fiable, sécurisé »' },

  { id: 'common.exclaim', level: 'error', re: /!(?!important|=)/g, msg: '感叹号' },
  { id: 'common.emoji', level: 'error', re: /(?![©®™‼⁉↔-↙↩↪])\p{Extended_Pictographic}/gu, msg: 'emoji' },
  { id: 'common.em-dash', level: 'error', re: /—|――/g, msg: '破折号：换成逗号、句号或冒号', shortLevel: 'warn' },
  { id: 'common.spaced-dash', level: 'warn', re: / – /g, msg: '空格包围的短破折号' },
  { id: 'common.arrow', level: 'warn', re: /[→↗➜➔⟶]/g, msg: '装饰箭头' },
  { id: 'common.deco', level: 'warn', re: /[✓✗✘★☆✦✧◆◇▶►]/g, msg: '装饰符号' },
  { id: 'common.question-heading', level: 'error', scope: 'heading', re: /[?？]\s*$/, msg: '问句标题' },
  { id: 'common.caps-label', level: 'warn', scope: 'short', textOnly: true, re: /^(?=.*[A-ZÀ-Þ].*\s)(?!.*[a-zà-ÿ])[A-ZÀ-Þ0-9&·'\-/ ]{8,}$/u, msg: '全大写标签（眉标）' },
  { id: 'common.placeholder', level: 'error', re: /\blorem ipsum\b|\bTODO\b|\bTBD\b|\bcoming soon\b|敬请期待|即将上线/gi, msg: '占位文字' },
];

// ---------- 文本提取 ----------
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', '.astro', '.turbo', '.svelte-kit', '.output', '.vercel', 'coverage', 'vendor', 'fonts', '.cache', '__pycache__', 'test-results', 'playwright-report', 'fixtures', '__fixtures__']);
const EXT = new Set(['.html', '.htm', '.md', '.mdx', '.txt', '.astro', '.vue', '.svelte', '.tsx', '.jsx', '.ts', '.js', '.mjs', '.json']);
const MAX_BYTES = 600_000;

function walk(p, out) {
  const st = statSync(p);
  if (st.isDirectory()) {
    for (const name of readdirSync(p)) if (!SKIP_DIRS.has(name) && !name.startsWith('.')) walk(join(p, name), out);
  } else if (EXT.has(extname(p)) && st.size <= MAX_BYTES) {
    const name = basename(p);
    if (/\.(test|spec|d)\.[cm]?[jt]sx?$/.test(name) || /\.min\.js$/.test(name)) return;
    if (/(banned-phrases|phrases|package(-lock)?|tsconfig|\.copylint)\.json$/.test(name)) return;
    if (/^(lint-copy|copy-lint|banned)/.test(name)) return;
    if (/^(CHANGELOG|LICENSE|README|CONTRIBUTING|AGENTS|CLAUDE|SECURITY|CODE_OF_CONDUCT)\b/i.test(name)) return;
    if (/\.m?js$/.test(name) && (/[.-][A-Za-z0-9_-]{8,}\.m?js$/.test(name) || /[\\/](_astro|_next|assets|chunks|static)[\\/]/.test(p))) return; // 打包产物
    out.push(p);
  }
}

const blank = (m) => m.replace(/[^\n]/g, ' ');
const decode = (s) => s
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;|&rsquo;|&lsquo;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&hellip;/g, '…')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d));

const HAS_CJK = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/;
// 字符串字面量里像文字的：有中日文、有空格的词句、或首字母大写的单词。class 列表、路径、标识符跳过。
function looksLikeCopy(s) {
  const t = s.trim();
  if (t.length < 2) return false;
  if (HAS_CJK.test(t)) return true;
  if (/^(https?:|mailto:|tel:|\/|\.\.?\/|#|@|data:)/.test(t)) return false;
  if (/[{};=<>]|=>|\$\{/.test(t)) return false;
  if (/^(SELECT|INSERT|UPDATE|DELETE|WITH|CREATE|ALTER|DROP|BEGIN|COMMIT)\b/i.test(t)) return false; // SQL
  const tokens = t.split(/\s+/);
  if (tokens.length === 1) return /^\p{Lu}[\p{Ll}'-]{2,}[.!?]?$/u.test(t);
  if (tokens.every((w) => /^[!a-z0-9:\-_/[\].%#()&>~+*@]+$/.test(w)) && tokens.some((w) => /[-:[]/.test(w))) return false; // class 列表
  return /\p{L}{2,}/u.test(t);
}
const ATTR_SKIP = /(?:class(?:Name)?|href|src|srcset|id|key|d|viewBox|xmlns|type|rel|role|as|name|for|htmlFor|method|target|fill|stroke|lang|style|data-[\w-]+|variant|size|icon|path|to|slot|ref|transform|points|width|height)\s*=\s*\{?\s*$/;
const IMPORT_SKIP = /(?:\bfrom|\bimport|\brequire\s*\(|\bimport\s*\()\s*$/;

const INLINE = new Set(['a', 'abbr', 'b', 'bdi', 'bdo', 'cite', 'code', 'data', 'dfn', 'em', 'i', 'kbd', 'mark', 'q', 's', 'samp', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var', 'wbr']);

function htmlSegments(src) {
  const segs = [];
  let s = src.replace(/<script\b[\s\S]*?<\/script>/gi, blank).replace(/<style\b[\s\S]*?<\/style>/gi, blank).replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/<![a-z][^>]*>|<\?xml[^>]*>/gi, blank);
  const tagRe = /<\/?([a-zA-Z][\w:-]*)\b[^>]*>/g;
  let last = 0; let heading = 0; let m;
  const push = (text, off, kind) => { const t = decode(text); if (/\p{L}|\p{Extended_Pictographic}|[!！?？—→↗➜➔⟶✓✗✘★☆✦✧◆◇▶►]/u.test(t)) segs.push({ text: t, off, kind }); };
  // 行内标签（strong、a、span…）不切断句子：攒到块级标签再交给规则
  let buf = ''; let bufOff = -1; let bufKind = 'text';
  const flush = () => { if (bufOff >= 0) push(buf, bufOff, bufKind); buf = ''; bufOff = -1; };
  while ((m = tagRe.exec(s))) {
    if (m.index > last) {
      const piece = s.slice(last, m.index);
      if (bufOff < 0 && piece.trim()) { bufOff = last + piece.indexOf(piece.trim()); bufKind = heading ? 'heading' : 'text'; }
      buf += piece;
    }
    const tag = m[0]; const name = m[1].toLowerCase();
    if (!INLINE.has(name)) flush();
    if (/^h[1-6]$/.test(name)) heading += tag.startsWith('</') ? -1 : 1;
    if (heading < 0) heading = 0;
    for (const a of tag.matchAll(/\b(alt|title|aria-label|placeholder|aria-description)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) push(a[2] ?? a[3], m.index + a.index, 'attr');
    if (name === 'meta' && /(name|property)\s*=\s*["'][^"']*(description|title)/i.test(tag)) {
      const c = tag.match(/\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i); if (c) push(c[1] ?? c[2], m.index + c.index, 'attr');
    }
    last = m.index + tag.length;
  }
  if (last < s.length) { const piece = s.slice(last); if (bufOff < 0 && piece.trim()) bufOff = last; buf += piece; }
  flush();
  return { segs, raw: s };
}

function codeSegments(src, ext) {
  const segs = [];
  let s = src.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/<!--[\s\S]*?-->/g, blank).replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, p) => p + blank(m.slice(p.length)));
  if (['.astro', '.vue', '.svelte'].includes(ext)) s = s.replace(/<style\b[\s\S]*?<\/style>/gi, blank);
  for (const m of s.matchAll(/(["'])((?:\\.|(?!\1)[^\\\n])*)\1|`((?:\\.|[^\\`])*)`/g)) {
    const body = m[2] ?? m[3] ?? '';
    const before = s.slice(Math.max(0, m.index - 40), m.index);
    if (ATTR_SKIP.test(before) || IMPORT_SKIP.test(before)) continue;
    const text = body.replace(/\$\{[^}]*\}/g, ' ').replace(/\\n/g, ' ').replace(/\\(["'`\\])/g, '$1');
    if (looksLikeCopy(text)) segs.push({ text: decode(text), off: m.index + 1, kind: 'string' });
  }
  if (['.tsx', '.jsx', '.astro', '.vue', '.svelte', '.mdx'].includes(ext)) {
    const tagged = s.replace(/(["'])(?:\\.|(?!\1)[^\\\n])*\1|`(?:\\.|[^\\`])*`/g, blank);
    let heading = 0;
    const tagRe = /<\/?([a-zA-Z][\w.:-]*)\b(?:[^>{}]|\{[^}]*\})*>/g; let last = 0; let m;
    while ((m = tagRe.exec(tagged))) {
      if (m.index > last) {
        const t = tagged.slice(last, m.index);
        if ((HAS_CJK.test(t) || /\p{L}{2,}\s+\p{L}{2,}/u.test(t) || /^\s*\p{Lu}\p{Ll}{2,}\s*$/u.test(t)) && !/[;=&|]{1}|=>|\breturn\b|\bconst\b/.test(t))
          for (const part of t.split(/\{[^}]*\}/)) if (part.trim()) segs.push({ text: decode(part.trim()), off: last + t.indexOf(part.trim()), kind: heading ? 'heading' : 'text' });
      }
      if (/^h[1-6]$/i.test(m[1])) heading = Math.max(0, heading + (m[0].startsWith('</') ? -1 : 1));
      last = m.index + m[0].length;
    }
  }
  return { segs, raw: s };
}

function jsonSegments(src) {
  const segs = [];
  for (const m of src.matchAll(/"((?:\\.|[^"\\])*)"/g)) {
    if (/^\s*:/.test(src.slice(m.index + m[0].length, m.index + m[0].length + 8))) continue; // 键名
    let t; try { t = JSON.parse(`"${m[1]}"`); } catch { continue; }
    if (looksLikeCopy(t)) segs.push({ text: t, off: m.index + 1, kind: 'string' });
  }
  return { segs, raw: src };
}

function mdSegments(src) {
  const segs = [];
  const s = src.replace(/^(```|~~~)[\s\S]*?^\1/gm, blank).replace(/`[^`\n]*`/g, blank).replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/\]\([^)]*\)/g, (m) => ']' + blank(m.slice(1))).replace(/^---\n[\s\S]*?\n---\n/, blank);
  let off = 0;
  for (const line of s.split('\n')) {
    const t = line.trim();
    if (t) {
      const heading = /^#{1,6}\s/.test(t);
      const text = t.replace(/^#{1,6}\s+|^[-*+]\s+|^\d+\.\s+|^>\s*/g, '').replace(/\*\*|__/g, '').replace(/!\[/g, ' [');
      segs.push({ text, off: off + line.indexOf(t), kind: heading ? 'heading' : 'text', md: t });
    }
    off += line.length + 1;
  }
  return { segs, raw: s };
}

// ---------- 检查 ----------
function lineOf(starts, off) { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= off) lo = mid; else hi = mid - 1; } return lo + 1; }
const snippet = (t, i, len) => { const a = Math.max(0, i - 12); const b = Math.min(t.length, i + len + 12); return (a > 0 ? '…' : '') + t.slice(a, b).replace(/\s+/g, ' ').trim() + (b < t.length ? '…' : ''); };

function checkFile(file) {
  const src = norm(readFileSync(file, 'utf8'));
  const ext = extname(file).toLowerCase();
  const { segs, raw } = ['.html', '.htm'].includes(ext) ? htmlSegments(src)
    : ['.md', '.txt'].includes(ext) ? mdSegments(src)
    : ext === '.json' ? jsonSegments(src) : codeSegments(src, ext);
  const starts = [0]; for (let i = 0; i < src.length; i++) if (src[i] === '\n') starts.push(i + 1);
  const found = [];
  const add = (rule, level, off, text, idx, len, extra) => found.push({ file, line: lineOf(starts, off), rule, level, msg: extra, snippet: snippet(text, idx, len) });

  for (const seg of segs) {
    let text = seg.text;
    let low = text.toLowerCase();
    for (const a of allow) if (low.includes(a)) { const re = new RegExp(esc(a), 'gi'); text = text.replace(re, (m) => ' '.repeat(m.length)); low = text.toLowerCase(); }
    const trimmed = text.trim();
    const isShort = trimmed.length <= 24 && !/[。.!?！？]\s*\S/.test(trimmed);
    for (const r of wordRules) {
      if (off.has(r.id) || off.has(`${r.id}:${r.phrase}`)) continue;
      r.re.lastIndex = 0; const m = r.re.exec(low);
      if (m) add(r.id, r.level, seg.off, text, m.index, m[0].length, `「${r.phrase}」`);
    }
    const hitIds = new Set();
    for (const r of structural) {
      if (off.has(r.id) || (r.lang && !langs.has(r.lang))) continue;
      if (r.unless && hitIds.has(r.unless)) continue;
      if (r.textOnly && !['text', 'heading', 'attr'].includes(seg.kind)) continue;
      if (r.scope === 'short' && !isShort) continue;
      if (r.scope === 'heading' && seg.kind !== 'heading') continue;
      const target = r.scope ? trimmed : text;
      r.re.lastIndex = 0; const m = r.re.exec(target);
      // Markdown 文档里的问句标题（FAQ、README）只提醒
      // 标题栏、窗口名里的「页面 — 品牌」分隔符只提醒
      const level = (r.id === 'common.question-heading' && seg.md) || (r.shortLevel && isShort) ? 'warn' : r.level;
      if (m) { hitIds.add(r.id); add(r.id, level, seg.off, target, m.index, m[0].length, r.msg); }
    }
    if (seg.md && !off.has('md.bold')) {
      if (/^[-*+]\s+\*\*[^*]+\*\*\s*[:：]/.test(seg.md)) add('md.bold-label', 'warn', seg.off, seg.md, 0, 10, '每条开头「加粗标签：」');
      else if (seg.kind !== 'heading' && /\S.*\*\*[^*\n]+\*\*|\*\*[^*\n]+\*\*.*\S/.test(seg.md)) add('md.bold', 'warn', seg.off, seg.md, seg.md.indexOf('**'), 8, '段落里的加粗');
    }
  }
  // 版式规则：在去掉脚本和样式的原文上找
  if (['.html', '.htm', '.tsx', '.jsx', '.astro', '.vue', '.svelte'].includes(ext)) {
    if (!off.has('layout.subtitle')) for (const m of raw.matchAll(/<\/h[1-6]>\s*<p\b[^>]*>([^<{\d]{1,80})<\/p>/gi)) add('layout.subtitle', 'warn', m.index, m[1], 0, m[1].length, '标题下紧跟一行短说明（副标题）');
    if (!off.has('layout.subtitle')) for (const m of raw.matchAll(/<hgroup\b/gi)) add('layout.subtitle', 'warn', m.index, '<hgroup>', 0, 8, 'hgroup（标题 + 副标题）');
    if (!off.has('layout.eyebrow-class')) for (const m of raw.matchAll(/\bclass(?:Name)?\s*=\s*["'{`][^"'`}]*?\b(eyebrow|kicker|overline|tagline|subtitle|sub-title|subheading|sub-heading|lede|hero-sub)\b/gi)) add('layout.eyebrow-class', 'warn', m.index, m[0], 0, m[0].length, `类名 ${m[1]}：眉标、副标题或标语`);
  }
  return found;
}

// ---------- 运行 ----------
let roots = opt.paths;
if (!roots.length) roots = existsSync('dist') ? ['dist'] : existsSync('src') ? ['src'] : ['.'];
const files = [];
for (const r of roots) {
  if (!existsSync(r)) { console.error(`lint-copy: 找不到 ${r}`); process.exit(2); }
  if (statSync(r).isFile()) files.push(resolve(r)); else walk(resolve(r), files); // 直接给的文件不过滤
}
const selfFiles = new Set([fileURLToPath(import.meta.url), join(here, 'phrases.json'), join(here, 'selftest.mjs')]);
const findings = files.filter((f) => !selfFiles.has(f) && !ignore.some((g) => f.includes(g))).flatMap(checkFile);

// 同一位置同一短语只报一次
const seen = new Set();
const out = findings.filter((f) => { const k = `${f.file}:${f.line}:${f.rule}:${f.msg}`; if (seen.has(k)) return false; seen.add(k); return true; });
const errors = out.filter((f) => f.level === 'error').length;
const warns = out.length - errors;

const show = (f) => { const r = relative(process.cwd(), f); return r.startsWith('..') ? f : r; };
if (opt.json) console.log(JSON.stringify(out.map((f) => ({ ...f, file: show(f.file) })), null, 1));
else {
  for (const f of out) if (!(opt.quiet && f.level === 'warn')) console.log(`${show(f.file)}:${f.line}  ${f.level === 'error' ? 'error' : 'warn '}  ${f.rule}  ${f.msg}  ${f.snippet}`);
  console.log(`lint-copy: ${files.length} 个文件，${errors} error，${warns} warn`);
}
process.exit(errors || (opt.strict && warns) ? 1 : 0);
