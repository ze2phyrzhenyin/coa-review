#!/usr/bin/env node
// 导航状态检查（AGENTS.md › Navigation，负责人 2026-11-08 的硬要求）：
//  1. 点侧栏换页后，侧栏滚动位置不变，当前项可见；
//  2. 新会话直接打开深层页面，当前项自动在视野内；
//  3. 页内标签页（role=tab）刷新后仍是刚才选中的那个（状态在网址里）；
//  4. 浏览器返回、前进回到带参数的页面时，网址参数和步数不变。
// 用法：PORT=4631 node scripts/qa-navigation.mjs      线上：ORIGIN=https://… node scripts/qa-navigation.mjs
// 需要侧栏够长才测得出滚动：本地用 VITE_SHOW_PLANNED=1 的构建（gate.sh --build 已这样做）。
import { finish, implementedIds, launch, open, pageIds } from './qa-lib.mjs';

const browser = await launch();
const failures = [];
const navState = (page) =>
  page.evaluate(() => {
    const nav = document.getElementById('nav');
    const active = nav?.querySelector('.nav-link[aria-current="page"]');
    if (!nav || !active) return { scroll: -1, visible: false, label: '' };
    const box = nav.getBoundingClientRect();
    const rect = active.getBoundingClientRect();
    return { scroll: Math.round(nav.scrollTop), visible: rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1, label: active.textContent.trim() };
  });

{
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 600 } })).newPage();
  await open(page, '');
  const links = page.locator('#nav .nav-link');
  const count = await links.count();
  if (count === 0) failures.push('侧栏里没有页面链接');
  const picks = count >= 12 ? [count - 1, Math.floor(count * 0.6), Math.floor(count * 0.85)] : [...Array(count).keys()].slice(-3);
  for (const index of picks) {
    const link = links.nth(index);
    await link.scrollIntoViewIfNeeded();
    const label = (await link.textContent()).trim();
    const before = await page.evaluate(() => document.getElementById('nav').scrollTop);
    await link.click();
    await page.waitForTimeout(200);
    const state = await navState(page);
    if (state.label !== label) failures.push(`点「${label}」后当前项是「${state.label}」`);
    if (!state.visible) failures.push(`点「${label}」后当前项不在视野内`);
    if (Math.abs(state.scroll - before) > 80) failures.push(`点「${label}」后侧栏位置变了（${Math.round(before)} → ${state.scroll}）`);
  }
  await page.context().close();
}

const deep = [pageIds.at(-1), pageIds[Math.floor(pageIds.length * 0.75)], pageIds[Math.floor(pageIds.length * 0.5)]];
for (const id of deep) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 600 } });
  const page = await context.newPage();
  await open(page, id);
  await page.waitForTimeout(150);
  if ((await page.locator('#nav .nav-link').count()) > 0) {
    const state = await navState(page);
    if (state.label && !state.visible) failures.push(`直接打开 /${id}，当前项「${state.label}」不在视野内`);
  }
  await context.close();
}

{
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  for (const id of implementedIds) {
    const page = await context.newPage();
    await open(page, id);
    const tabs = page.locator('#main [role="tab"]');
    if ((await tabs.count()) >= 2) {
      const label = (await tabs.nth(1).textContent()).trim();
      await tabs.nth(1).click();
      await page.reload({ waitUntil: 'load' });
      await page.locator('#main h1').first().waitFor();
      const selected = (await page.locator('#main [role="tab"][aria-selected="true"]').first().textContent().catch(() => ''))?.trim();
      if (selected !== label) failures.push(`/${id}：标签页「${label}」刷新后丢了（状态要写进网址）`);
    }
    await page.close();
  }
  await context.close();
}
// 4. 浏览器返回、前进：回到带参数的页面时，网址参数和步数与离开时一样（离开的那一页不许改写新页面的网址）。
{
  const withPlayer = implementedIds.filter((id) => id !== '');
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  // 每页配它后面的一页（末页配首页）：每页都当一次「离开的页」和一次「到达的页」。两两全配是 n² 组，27 页要跑二十多分钟。
  for (const [at, id] of withPlayer.entries()) for (const other of withPlayer.length > 1 ? [withPlayer[(at + 1) % withPlayer.length]] : []) {
    // 停在靠后的一步（别的页面步数上限更小时，最容易把参数改掉）。
    await open(page, `${id}?s=999`);
    if (!(await page.locator('[data-player]').count())) continue;
    await page.locator('[data-player]').first().focus();
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(300);
    const leftUrl = page.url();
    const leftStep = await page.locator('[data-player]').first().getAttribute('data-step-index');
    const link = page.locator(`#nav a[href="/${other}"]`).first();
    if (await link.count()) await link.click();
    else await page.evaluate((path) => { history.pushState(null, '', path); dispatchEvent(new PopStateEvent('popstate')); }, `/${other}`);
    await page.locator('#main h1').first().waitFor();
    await page.waitForTimeout(400);
    await page.goBack();
    await page.locator('[data-player]').first().waitFor();
    await page.waitForTimeout(500);
    const backUrl = page.url();
    const backStep = await page.locator('[data-player]').first().getAttribute('data-step-index');
    if (backUrl !== leftUrl) failures.push(`/${id}：去 /${other} 再按返回，网址从 ${new URL(leftUrl).search || '(空)'} 变成 ${new URL(backUrl).search || '(空)'}`);
    if (backStep !== leftStep) failures.push(`/${id}：按返回后步数是 ${backStep}，离开时是 ${leftStep}`);
    await page.goForward();
    await page.locator('#main h1').first().waitFor();
    await page.waitForTimeout(300);
    await page.goBack();
    await page.locator('[data-player]').first().waitFor();
    await page.waitForTimeout(500);
    if (page.url() !== leftUrl) failures.push(`/${id}：前进再返回后网址变成 ${new URL(page.url()).search || '(空)'}`);
  }
  await context.close();
}

await browser.close();
finish('qa-navigation', failures);
