#!/usr/bin/env node
// 手机上逐步查裁切：每个页面的每道讲解例题、每一步，在 360×740 和 390×844 两种屏上，
// 这一步的焦点（出题时是题目问的部件；场景写在 [data-stage] 的 data-clipped 里）必须完整留在舞台里；
// 点选题的候选可以分在几个画面里，但每个候选要么就在这一步的画面里，要么按一次「看……」就完整看到（data-unreachable 为空）；
// 顺带报压字（data-text-overlaps）和小于 12 像素的字（data-min-text）。约定见 specs/_scene-contract.md「DOM 约定」。
// 用法：PORT=4631 node scripts/qa-clip.mjs [--strict] <页面编号…>     还没接进 gate.sh。
import { finish, implementedIds, launch, origin } from './qa-lib.mjs';

// --strict：再加一条，停稳的画面里任何看得见的部件、标签都不许被舞台的左右边切开（data-cut-parts），不只查焦点和候选。
const args = process.argv.slice(2);
const strict = args.includes('--strict');
const named = args.filter((arg) => !arg.startsWith('--'));
const ids = named.length ? named : implementedIds;
const STEP_TIMEOUT = 15_000;
const PAGE_TIMEOUT = 240_000;
const sizes = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
];
const failures = [];
const browser = await launch();
const kill = setTimeout(() => {
  console.log('✗ 整体超时（10 分钟）');
  process.exit(1);
}, 600_000);

const settled = (page) => page.waitForFunction(() => document.querySelector('[data-stage]')?.getAttribute('data-settled') === 'true', null, { timeout: STEP_TIMEOUT });

/**
 * 讲解标签页里选例题的控件：一组按钮（[aria-label="例题"]），或窄屏上换成的下拉框（标签文字里有「例题」）。
 * 都没有就只有一道例题。返回 { count, pick(i) }。
 */
async function examples(page) {
  const buttons = page.locator('[aria-label="例题"] button:visible');
  const n = await buttons.count();
  if (n > 0) return { count: n, pick: (i) => buttons.nth(i).click() };
  const select = page.locator('label:has-text("例题") select:visible, select[aria-label="例题"]:visible').first();
  if (await select.count()) {
    const options = await select.locator('option').count();
    return { count: options, pick: (i) => select.selectOption({ index: i }) };
  }
  return { count: 1, pick: async () => {} };
}

for (const viewport of sizes) {
  const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  page.setDefaultTimeout(STEP_TIMEOUT);
  for (const id of ids) {
    const started = Date.now();
    const where = `/${id} ${viewport.width}×${viewport.height}`;
    try {
      await page.goto(`${origin}/${id}`, { waitUntil: 'load' });
      if (!(await page.locator('[data-player]').count())) await page.locator('[data-player]').first().waitFor({ timeout: 5_000 }).catch(() => {});
      if (!(await page.locator('[data-player]').count())) continue;
      const { count } = await examples(page);
      for (let ex = 0; ex < count; ex++) {
        await page.goto(`${origin}/${id}`, { waitUntil: 'load' });
        await page.locator('[data-player]').first().waitFor();
        await (await examples(page)).pick(ex);
        await page.locator('.pl-count').first().waitFor();
        const base = new URL(page.url());
        const total = Number(/共 (\d+) 步/.exec(await page.locator('.pl-count').first().textContent())?.[1] ?? 0);
        const name = count > 1 ? `例 ${ex + 1}` : '';
        for (let s = 0; s <= total; s++) {
          if (Date.now() - started > PAGE_TIMEOUT) throw new Error('这一页超过 4 分钟');
          base.searchParams.set('s', String(s));
          await page.goto(base.href, { waitUntil: 'load' });
          await settled(page);
          const facts = await page.evaluate(() => {
            const stage = document.querySelector('[data-stage]');
            return { mode: document.querySelector('[data-player]').dataset.mode, clipped: stage.dataset.clipped ?? '', cut: stage.dataset.cutParts ?? '', unreachable: stage.dataset.unreachable ?? '', overlaps: stage.dataset.textOverlaps ?? '', min: Number(stage.dataset.minText ?? 99) };
          });
          if (facts.mode !== 'scene') continue;
          const at = `${where} ${name} 第 ${s} 步`;
          if (facts.clipped) failures.push(`${at}：焦点或候选没有完整留在画面里：${facts.clipped}`);
          if (facts.unreachable) failures.push(`${at}：候选按一次「看……」也看不全：${facts.unreachable}`);
          if (strict && facts.cut) failures.push(`${at}：被左右边切开：${facts.cut}`);
          if (facts.overlaps) failures.push(`${at}：压字：${facts.overlaps}`);
          if (facts.min > 0 && facts.min < 12) failures.push(`${at}：字小于 12 像素（${facts.min}）`);
        }
      }
    } catch (error) {
      failures.push(`${where}：${error instanceof Error ? error.message.split('\n')[0] : error}`);
    }
  }
  await context.close();
}
await browser.close();
clearTimeout(kill);
finish('qa-clip', failures);
