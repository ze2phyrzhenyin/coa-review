#!/usr/bin/env node
// 功能清单只许改 passes 和 evidence（规划时除外：COA_ROLE=planner）。passes 为 true 必须写证据。
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const now = JSON.parse(readFileSync('plan/features.json', 'utf8'));
const problems = [];
for (const feature of now.features) {
  if (feature.passes && !String(feature.evidence ?? '').trim()) problems.push(`${feature.id}：passes 为 true 但没写 evidence（验收记录的路径）`);
}
let before = null;
try {
  before = JSON.parse(execFileSync('git', ['show', 'HEAD:plan/features.json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
} catch {
  /* 首次提交之前没有可比的版本 */
}
if (before && process.env.COA_ROLE !== 'planner') {
  const strip = (doc) => JSON.stringify({ ...doc, features: doc.features.map(({ passes, evidence, ...rest }) => rest) });
  if (strip(before) !== strip(now)) problems.push('plan/features.json 被改了 passes、evidence 以外的内容；增删页面或改验收条件由 planner 做（COA_ROLE=planner）');
}
if (problems.length) {
  console.log(problems.map((p) => `✗ ${p}`).join('\n'));
  process.exit(1);
}
console.log('features ok');
