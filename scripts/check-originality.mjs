#!/usr/bin/env node
// 原创检查：src 里的中文文字不许与教材、解析书的扫描文本有长段重合（连续 28 个汉字以上）。
// 只在本机有 .local/textbook/*.txt 时运行；没有就跳过（CI、别人的机器）。
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const sources = ['.local/textbook/book.txt', '.local/textbook/solutions.txt'].filter((f) => existsSync(f));
if (sources.length === 0) {
  console.log('originality skipped：没有 .local/textbook 文本');
  process.exit(0);
}
const WINDOW = 28;
const keep = (text) => text.replace(/[^一-鿿]/g, '');
const book = sources.map((f) => keep(readFileSync(f, 'utf8'))).join('\u0000');
const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
const problems = [];
for (const file of walk('src').filter((f) => /\.(tsx?|json|md)$/.test(f))) {
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      const text = keep(line);
      for (let start = 0; start + WINDOW <= text.length; start += 6) {
        const piece = text.slice(start, start + WINDOW);
        if (book.includes(piece)) {
          problems.push(`${file}:${i + 1}：与教材原文重合「${piece}…」，用自己的话和自己的数重写`);
          break;
        }
      }
    });
}
if (problems.length) {
  console.log(problems.map((p) => `✗ ${p}`).join('\n'));
  process.exit(1);
}
console.log('originality ok');
