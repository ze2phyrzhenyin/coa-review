#!/usr/bin/env node
// 术语检查：给学生看的文字用教材的说法（scripts/terms.json）。用法：node scripts/lint-terms.mjs [目录…]
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const { terms } = JSON.parse(readFileSync(new URL('./terms.json', import.meta.url), 'utf8'));
const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
const dirs = process.argv.slice(2).length ? process.argv.slice(2) : ['src'];
const problems = [];
for (const dir of dirs) {
  for (const file of walk(dir).filter((f) => /\.(tsx?|json|md|html)$/.test(f) && !/\.test\.tsx?$/.test(f))) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (line.includes('terms-ok')) return;
        for (const term of terms) {
          if (line.includes(term.ban)) problems.push(`${file}:${i + 1}：「${term.ban}」改成「${term.use}」（${term.ref}）；确要保留就在行尾注 terms-ok`);
        }
      });
  }
}
if (problems.length) {
  console.log(problems.map((p) => `✗ ${p}`).join('\n'));
  process.exit(1);
}
console.log('terms ok');
