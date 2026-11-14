#!/usr/bin/env node
// 逐页检查（手机 360×740、桌面 1280×800）：控制台无报错、只有一个标题、不横向滚动、触控目标不小于 44 px、
// 输入框文字不小于 16 px、看得见的文字里没有 S_f1、2^3 这类没排版的上下标记号。带播放器的页面（[data-player]，见 specs/_player-contract.md）再查：
// 每个标签页都查这几项。带播放器的页面再查：键盘前进与后退、回退后画面与当初一致、步数写进网址且刷新后还原、Home 回到开头、减少动态效果时没有位移动画。
// 用法：PORT=4631 node scripts/qa-pages.mjs [页面编号…]
import { finish, implementedIds, launch, open, pageIds } from './qa-lib.mjs';

const only = process.argv.slice(2);
// 首页、全部已实现的页面，再抽两个占位页（它们彼此相同）。
const placeholders = pageIds.filter((id) => !implementedIds.includes(id)).slice(0, 2);
const ids = only.length ? only : ['', ...implementedIds, ...placeholders];
const browser = await launch();
const failures = [];
const sizes = [
  { name: '手机', viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true },
  { name: '桌面', viewport: { width: 1280, height: 800 } },
];

/** 页面上的检查项。在浏览器里跑。 */
function collectFacts() {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  };
  const small = [...document.querySelectorAll('button, [role="button"], [role="tab"], .nav a, select, input:not([type="hidden"])')]
    .filter(visible)
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ r }) => r.width < 43.5 || r.height < 43.5)
    .map(({ el, r }) => `${el.tagName.toLowerCase()}「${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 12)}」${Math.round(r.width)}×${Math.round(r.height)}`);
  const tiny = [...document.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]), select, textarea')]
    .filter(visible)
    .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16)
    .map((el) => `${el.getAttribute('aria-label') || el.id || el.tagName.toLowerCase()} ${getComputedStyle(el).fontSize}`);
  const main = document.getElementById('main');
  return {
    h1: document.querySelectorAll('h1').length,
    overflow: document.documentElement.scrollWidth - innerWidth,
    mainOverflow: main ? main.scrollWidth - main.clientWidth : 0,
    small,
    tiny,
    player: !!document.querySelector('[data-player]'),
    // 上下标要排成 <sub>/<sup>，不能把下划线和尖号直接给学生看。
    raw: [...(main?.innerText ?? '').matchAll(/[A-Za-z0-9)\]][_^](?:\{|\(|[-−]?[A-Za-z0-9])/g)].map((m) => m[0]).slice(0, 3),
  };
}

function report(where, size, facts) {
  if (facts.overflow > 1 || facts.mainOverflow > 1) failures.push(`${where}：横向溢出 ${Math.max(facts.overflow, facts.mainOverflow)} px；宽图放进自己的滚动容器或按步骤切局部`);
  if (size.isMobile && facts.small.length) failures.push(`${where}：触控目标小于 44 px：${facts.small.slice(0, 4).join('、')}`);
  if (facts.raw.length) failures.push(`${where}：文字里有没排版的上下标记号：${facts.raw.join('、')}（用 <sub>/<sup>，播放器里用 Rich）`);
  if (size.isMobile && facts.tiny.length) failures.push(`${where}：${facts.tiny.length} 个输入框文字小于 16 px（iOS 会放大页面）：${facts.tiny.slice(0, 3).join('、')}`);
}

for (const size of sizes) {
  const context = await browser.newContext(size);
  for (const id of ids) {
    const where = `/${id}（${size.name}）`;
    const page = await context.newPage();
    const errors = [];
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
    page.on('pageerror', (error) => errors.push(error.message));
    await open(page, id);
    const facts = await page.evaluate(collectFacts);
    if (errors.length) failures.push(`${where}：控制台报错 ${errors[0].slice(0, 140)}`);
    if (facts.h1 !== 1) failures.push(`${where}：h1 有 ${facts.h1} 个，应为 1 个`);
    report(where, size, facts);

    // 每个标签页（讲解、试一试、练习……）都查一遍：触控目标、输入框字号、上下标记号、横向溢出。
    const tabs = await page.locator('#main [role="tab"]').count();
    for (let t = 0; t < tabs; t++) {
      const tab = page.locator('#main [role="tab"]').nth(t);
      if ((await tab.getAttribute('aria-selected')) === 'true') continue;
      const label = (await tab.textContent()).trim();
      await tab.click();
      await page.waitForTimeout(250);
      report(`${where}「${label}」`, size, await page.evaluate(collectFacts));
    }
    if (tabs > 0) {
      await open(page, id);
    }

    if (facts.player) {
      const index = () => page.locator('[data-player]').first().getAttribute('data-step-index').then(Number);
      const stage = () => page.locator('[data-player] [data-stage]').first().innerHTML();
      await page.locator('[data-player]').first().focus();
      await page.keyboard.press('Home');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(700);
      if ((await index()) !== 2) failures.push(`${where}：按两次 → 后步数是 ${await index()}，应为 2`);
      const atTwo = await stage();
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(700);
      await page.keyboard.press('ArrowLeft');
      await page.waitForTimeout(700);
      if ((await index()) !== 2) failures.push(`${where}：← 没有回到第 2 步`);
      else if ((await stage()) !== atTwo) failures.push(`${where}：回退后画面与当初的第 2 步不一致（画面只能由 Trace 的状态决定）`);
      if (!new URL(page.url()).searchParams.has('s')) failures.push(`${where}：步数没有写进网址（参数 s）`);
      await page.reload({ waitUntil: 'load' });
      await page.locator('[data-player]').first().waitFor();
      if ((await index()) !== 2) failures.push(`${where}：刷新后步数是 ${await index()}，应还原为 2`);
      await page.locator('[data-player]').first().focus();
      await page.keyboard.press('Home');
      if ((await index()) !== 0) failures.push(`${where}：Home 没有回到开头`);
    }
    await page.close();
  }
  await context.close();
}

// 减少动态效果：推进一步后不应有仍在运行的位移动画。
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  for (const id of ids) {
    const page = await context.newPage();
    await open(page, id);
    if (await page.locator('[data-player]').count()) {
      await page.locator('[data-player]').first().focus();
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(60);
      const moving = await page.evaluate(
        () =>
          document.getAnimations().filter((a) => {
            const timing = a.effect?.getTiming();
            const frames = a.effect?.getKeyframes?.() ?? [];
            return a.playState === 'running' && Number(timing?.duration) > 120 && frames.some((f) => 'transform' in f || 'offsetDistance' in f || 'translate' in f);
          }).length,
      );
      if (moving) failures.push(`/${id}：系统要求减少动态效果时仍有 ${moving} 个位移动画`);
    }
    await page.close();
  }
  await context.close();
}
await browser.close();
finish('qa-pages', failures);
