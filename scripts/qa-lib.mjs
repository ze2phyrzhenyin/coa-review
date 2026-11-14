// qa 脚本共用：浏览器、页面清单、结果输出。
import { chromium } from '@playwright/test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

export const origin = (process.env.ORIGIN ?? `http://127.0.0.1:${process.env.PORT ?? '4631'}`).replace(/\/+$/, '');
export const pageIds = [...readFileSync(new URL('../src/content/pages.ts', import.meta.url), 'utf8').matchAll(/^\s*p\('([^']+)'/gm)].map((m) => m[1]);
// 已有实现的页面：src/pages/<编号>/index.tsx 存在。占位页彼此相同，逐页检查只抽两个。
const pagesDir = new URL('../src/pages/', import.meta.url);
export const implementedIds = existsSync(pagesDir)
  ? readdirSync(pagesDir).filter((name) => existsSync(new URL(`${name}/index.tsx`, pagesDir)) && pageIds.includes(name))
  : [];
/** 打开页面并等到标题出现。不用 networkidle：静态站点没有后续请求，白等半秒。 */
export async function open(page, path) {
  await page.goto(`${origin}/${path}`, { waitUntil: 'load' });
  await page.locator('#main h1').first().waitFor({ timeout: 10_000 });
}
// 静音且不进系统「正在播放」（负责人 2026-11-12 的要求）。
// macOS 上无头浏览器默认是软件渲染，三维场景会退到平面模式；加这三项才用得上显卡。
const gpu = process.platform === 'darwin' ? ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] : [];
export const launch = () => chromium.launch({ args: ['--mute-audio', ...gpu] });
export function finish(name, failures) {
  if (failures.length) {
    console.log(failures.map((f) => `✗ ${f}`).join('\n'));
    console.log(`${name}：${failures.length} 处问题`);
    process.exit(1);
  }
  console.log(`${name} ok`);
}
