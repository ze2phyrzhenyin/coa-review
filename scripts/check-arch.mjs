#!/usr/bin/env node
// 结构检查：引擎和 lib 是纯函数。不碰界面、不碰浏览器对象、不用随机数和当前时间
// （同样的参数必须得到同样的 Trace，才能回退、对拍、写进网址）。
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
const rules = [
  [/from\s+['"](preact|preact\/[^'"]+|@preact\/[^'"]+)['"]/, '引擎不引用 preact；界面放 src/pages 或 src/player'],
  [/from\s+['"](\.\.\/)+(app|pages|player|ui)\//, '引擎不引用界面目录'],
  [/\b(document|window|localStorage|sessionStorage|navigator|location)\s*[.[]/, '引擎不用浏览器对象；需要的值作为参数传入'],
  [/\bMath\.random\s*\(|\bDate\.now\s*\(|\bnew Date\s*\(\s*\)/, '引擎不用随机数和当前时间；出题的随机种子作为参数传入'],
];
const problems = [];
for (const dir of ['src/engines', 'src/lib']) {
  let files = [];
  try {
    files = walk(dir);
  } catch {
    continue;
  }
  for (const file of files.filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))) {
    if (file.endsWith('.tsx')) problems.push(`${file}：引擎目录里不放 .tsx`);
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        for (const [pattern, fix] of rules) if (pattern.test(line)) problems.push(`${file}:${i + 1}：${fix}`);
      });
  }
}
// shell 脚本：$变量 后面紧跟全角字符时，bash 会把全角字符的字节算进变量名（set -u 下直接报错）。要写 ${变量}。
for (const dir of ['scripts', '.claude/hooks']) {
  let names = [];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith('.sh'));
  } catch {
    continue;
  }
  for (const name of names) {
    readFileSync(join(dir, name), 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (/\$[A-Za-z_][A-Za-z0-9_]*[^\x00-\x7F]/.test(line)) problems.push(`${dir}/${name}:${i + 1}：变量后面紧跟全角字符，写成 \${变量}`);
      });
  }
}
if (problems.length) {
  console.log(problems.map((p) => `✗ ${p}`).join('\n'));
  process.exit(1);
}
console.log('arch ok');
