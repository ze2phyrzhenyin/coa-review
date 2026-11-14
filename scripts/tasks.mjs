#!/usr/bin/env node
// 任务图工具。图在 plan/tasks.json（只有 planner 改），每个任务的状态在 plan/state/<id>.json（一任务一文件，
// 并行的 worktree 不会互相覆盖），交接记录在 plan/progress/<id>.md。
//
//   node scripts/tasks.mjs list                 全部任务和状态
//   node scripts/tasks.mjs ready [--json] [--max N]   依赖已完成、范围互不重叠、也不与进行中任务重叠的任务
//   node scripts/tasks.mjs show <id>            一个任务的全部信息（循环执行器把它贴进提示词）
//   node scripts/tasks.mjs claim|done|reset <id> [--by 名字]
//   node scripts/tasks.mjs block <id> "卡在哪"
//   node scripts/tasks.mjs scope <id> [--base <git ref>]   改动是否都在任务范围内
//   node scripts/tasks.mjs order                依赖拓扑序（合并顺序）
//   node scripts/tasks.mjs validate             图、页面清单、功能清单、skill 链接是否自洽
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const at = (...parts) => join(root, ...parts);
const [command, ...rest] = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : fallback;
};
const has = (name) => rest.includes(`--${name}`);
const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const STATES = ['todo', 'doing', 'done', 'blocked'];
const graph = JSON.parse(readFileSync(at('plan/tasks.json'), 'utf8'));
const tasks = graph.tasks;
const byId = new Map(tasks.map((task) => [task.id, task]));

function stateOf(id) {
  const file = at('plan/state', `${id}.json`);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { state: 'todo' };
}
function setState(id, state, extra = {}) {
  if (!byId.has(id)) fail(`没有任务 ${id}`);
  mkdirSync(at('plan/state'), { recursive: true });
  const record = { state, by: flag('by', process.env.COA_AGENT ?? 'human'), at: new Date().toISOString(), ...extra };
  writeFileSync(at('plan/state', `${id}.json`), `${JSON.stringify(record, null, 2)}\n`);
  console.log(`${id} → ${state}`);
}

// 范围按路径前缀比较。`src/engines/cache/` 或 `src/engines/cache/**` 表示整个目录；
// `src/engines/parity/model*` 表示以这个名字开头的文件（model.ts、model.test.ts）。
const prefix = (glob) => glob.replace(/\*.*$/, '');
const isDir = (glob) => !/[^/]\*/.test(glob) && !/\.[a-z]+$/.test(glob);
const covers = (glob, path) => {
  const base = prefix(glob);
  if (base === '' || path === base || glob === path) return true;
  return isDir(glob) ? path.startsWith(base.endsWith('/') ? base : `${base}/`) : path.startsWith(base);
};
const overlap = (a, b) => covers(a, prefix(b)) || covers(b, prefix(a));
const scopesOverlap = (one, two) => one.scope.some((a) => two.scope.some((b) => overlap(a, b)));
const inScope = (task, file) => task.scope.some((glob) => covers(glob, file));

function ready() {
  const doing = tasks.filter((task) => stateOf(task.id).state === 'doing');
  const picked = [];
  for (const task of tasks) {
    if (stateOf(task.id).state !== 'todo') continue;
    if (!task.depends.every((dep) => stateOf(dep).state === 'done')) continue;
    if ([...doing, ...picked].some((other) => scopesOverlap(task, other))) continue;
    picked.push(task);
  }
  return picked;
}

function order() {
  const seen = new Set();
  const out = [];
  const visit = (id, trail) => {
    if (trail.includes(id)) fail(`依赖成环：${[...trail, id].join(' → ')}`);
    if (seen.has(id)) return;
    for (const dep of byId.get(id).depends) visit(dep, [...trail, id]);
    seen.add(id);
    out.push(id);
  };
  for (const task of tasks) visit(task.id, []);
  return out;
}

function validate() {
  const problems = [];
  const ids = new Set();
  for (const task of tasks) {
    if (ids.has(task.id)) problems.push(`任务 id 重复：${task.id}`);
    ids.add(task.id);
    for (const key of ['id', 'title', 'skill', 'role', 'accept']) if (!task[key]) problems.push(`${task.id}：缺 ${key}`);
    if (!Array.isArray(task.scope) || task.scope.length === 0) problems.push(`${task.id}：缺文件范围 scope`);
    for (const dep of task.depends ?? []) if (!byId.has(dep)) problems.push(`${task.id}：依赖 ${dep} 不存在`);
    // 规格可以由前置任务写出：前置任务都完成之后才要求它存在。
    const depsDone = (task.depends ?? []).every((dep) => stateOf(dep).state === 'done');
    if (task.spec && depsDone && !existsSync(at(task.spec.split('#')[0]))) problems.push(`${task.id}：规格 ${task.spec} 不存在`);
    if (task.skill && !existsSync(at('.agents/skills', task.skill, 'SKILL.md'))) problems.push(`${task.id}：skill ${task.skill} 不存在`);
    if (task.role && !existsSync(at('prompts/roles', `${task.role}.md`))) problems.push(`${task.id}：角色 ${task.role} 不存在`);
    const state = stateOf(task.id).state;
    if (!STATES.includes(state)) problems.push(`${task.id}：状态 ${state} 不认识`);
  }
  if (problems.length === 0) order();
  for (const file of existsSync(at('plan/state')) ? readdirSync(at('plan/state')) : []) {
    if (!byId.has(file.replace(/\.json$/, ''))) problems.push(`plan/state/${file} 没有对应任务`);
  }

  // 页面编号三处一致：src/content/pages.ts、docs/PLAN.md、plan/features.json
  const inCode = [...readFileSync(at('src/content/pages.ts'), 'utf8').matchAll(/^\s*p\('([^']+)'/gm)].map((m) => m[1]);
  const inPlan = [...readFileSync(at('docs/PLAN.md'), 'utf8').matchAll(/^\| (\d-[a-z0-9-]+) \|/gm)].map((m) => m[1]);
  const features = JSON.parse(readFileSync(at('plan/features.json'), 'utf8')).features;
  const inFeatures = features.map((feature) => feature.id);
  const same = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
  if (new Set(inCode).size !== inCode.length) problems.push('src/content/pages.ts 里页面编号重复');
  if (!same(inCode, inPlan)) problems.push(`页面编号不一致：pages.ts ${inCode.length} 个，PLAN.md ${inPlan.length} 个`);
  if (!same(inCode, inFeatures)) problems.push(`页面编号不一致：pages.ts ${inCode.length} 个，features.json ${inFeatures.length} 个`);
  const live = [...readFileSync(at('src/content/pages.ts'), 'utf8').matchAll(/^\s*p\('([^']+)'.*, true\),?$/gm)].map((m) => m[1]);
  for (const feature of features) {
    if (live.includes(feature.id) && !feature.passes) problems.push(`${feature.id} 已上线（live），但 features.json 里 passes 不是 true`);
  }

  // skill 两处都读得到（Claude Code 走 .claude/skills，其余工具走 .agents/skills）
  for (const name of readdirSync(at('.agents/skills'))) {
    if (!existsSync(at('.agents/skills', name, 'SKILL.md'))) problems.push(`.agents/skills/${name} 缺 SKILL.md`);
    else if (!existsSync(at('.claude/skills', name, 'SKILL.md'))) problems.push(`.claude/skills/${name}/SKILL.md 读不到（检查软链接）`);
  }
  if (problems.length) fail(problems.map((line) => `✗ ${line}`).join('\n'));
  console.log(`tasks ok：${tasks.length} 个任务，${inCode.length} 个页面`);
}

switch (command) {
  case 'list':
    for (const task of tasks) {
      const record = stateOf(task.id);
      console.log(`${task.id}  ${record.state.padEnd(7)} ${task.role.padEnd(11)} ${task.title}${record.note ? `  （${record.note}）` : ''}`);
    }
    break;
  case 'ready': {
    const list = ready().slice(0, Number(flag('max', 99)));
    console.log(has('json') ? JSON.stringify(list.map((task) => task.id)) : list.map((task) => task.id).join('\n'));
    break;
  }
  case 'show': {
    const task = byId.get(rest[0]) ?? fail(`没有任务 ${rest[0]}`);
    console.log(JSON.stringify({ ...task, ...stateOf(task.id) }, null, 2));
    break;
  }
  case 'claim':
    if (stateOf(rest[0]).state === 'doing') fail(`${rest[0]} 已被领走`);
    setState(rest[0], 'doing');
    break;
  case 'done':
    setState(rest[0], 'done');
    break;
  case 'reset':
    setState(rest[0], 'todo');
    break;
  case 'block':
    setState(rest[0], 'blocked', { note: rest[1] ?? '' });
    break;
  case 'order':
    console.log(order().join('\n'));
    break;
  case 'scope': {
    const task = byId.get(rest[0]) ?? fail(`没有任务 ${rest[0]}`);
    const base = flag('base', 'HEAD');
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
    const changed = new Set([
      ...git('diff', '--name-only', base),
      ...git('ls-files', '--others', '--exclude-standard'),
    ]);
    const own = [`plan/state/${task.id}.json`, `plan/progress/${task.id}.md`];
    const outside = [...changed].filter((file) => !own.includes(file) && !inScope(task, file));
    if (outside.length) fail(`✗ ${task.id} 改了范围外的文件：\n  ${outside.join('\n  ')}\n  范围：${task.scope.join(' ')}\n  需要改这些文件就在 plan/progress/${task.id}.md 里写明，交给 planner 调整任务图。`);
    console.log(`scope ok：${changed.size} 个文件都在 ${task.id} 的范围内`);
    break;
  }
  case 'validate':
    validate();
    break;
  default:
    fail('用法：node scripts/tasks.mjs list|ready|show|claim|done|reset|block|scope|order|validate');
}
