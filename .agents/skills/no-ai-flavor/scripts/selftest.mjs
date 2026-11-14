#!/usr/bin/env node
// 自测：bad.html 必须命中下面每条规则，good.html 必须零发现。改了词表或规则后跑一次。
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const run = (file) => {
  try { return JSON.parse(execFileSync(process.execPath, [join(here, 'lint-copy.mjs'), '--json', join(here, 'fixtures', file)], { encoding: 'utf8' })); }
  catch (e) { return JSON.parse(e.stdout); }
};

const expected = [
  'zh.time-opener', 'zh.steps3', 'zh.short-pair', 'zh.not-but', 'zh.every-deserves', 'zh.just-need', 'zh.count-big',
  'zh.triad', 'zh.make-better', 'zh.fullwidth-exclaim', 'zh.word', 'fr.not-but', 'fr.word', 'en.word',
  'common.em-dash', 'common.emoji', 'common.arrow', 'common.question-heading', 'common.caps-label',
  'layout.subtitle', 'layout.eyebrow-class',
];
const bad = run('bad.html');
const hit = new Set(bad.map((f) => f.rule));
const missing = expected.filter((r) => !hit.has(r));
const good = run('good.html');

let ok = true;
if (missing.length) { ok = false; console.log('bad.html 漏报：', missing.join(', ')); }
if (good.length) { ok = false; console.log('good.html 误报：'); for (const f of good) console.log(`  ${f.line} ${f.rule} ${f.msg} ${f.snippet}`); }
console.log(ok ? `selftest: ok（bad.html ${bad.length} 条发现，覆盖 ${expected.length} 条规则；good.html 0 条）` : 'selftest: 失败');
process.exit(ok ? 0 : 1);
