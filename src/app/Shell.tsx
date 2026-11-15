import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { chapters, pages, visiblePages } from '../content/pages';
import { useRecordVisit } from './last-visit';
import { onLinkClick, usePath } from './router';

/**
 * 外壳：侧栏只挂载一次，换页不重建，所以滚动位置不动（AGENTS.md › Navigation）。
 * 直接打开深层页面时把当前项滚进视野。版式见 docs/DESIGN.md「版面」。
 */
export function Shell({ render }: { render: (pageId: string | null) => ComponentChildren }) {
  const path = usePath();
  const pageId = path === '/' ? null : path.slice(1);
  const nav = useRef<HTMLElement>(null);
  const main = useRef<HTMLElement>(null);
  const listed = visiblePages();
  const page = pages.find((item) => item.id === pageId) ?? null;
  // 窄屏上章节列表默认收起，顶栏只占一行；侧栏仍然只挂载一次。
  const [open, setOpen] = useState(false);

  useRecordVisit(page ? page.id : null);

  useEffect(() => setOpen(false), [pageId]);

  // 换页后正文回到顶部；侧栏不动。
  useEffect(() => {
    if (main.current) main.current.scrollTop = 0;
  }, [pageId]);

  useEffect(() => {
    const active = nav.current?.querySelector('[aria-current="page"]');
    if (!active || !nav.current) return;
    const box = nav.current.getBoundingClientRect();
    const rect = active.getBoundingClientRect();
    // 完全不在视野里（直接打开深层页面）才居中；只露出一部分（刚点的就是它）时只挪到刚好露全，侧栏不跳。
    if (rect.bottom <= box.top || rect.top >= box.bottom) active.scrollIntoView({ block: 'center' });
    else if (rect.top < box.top || rect.bottom > box.bottom) active.scrollIntoView({ block: 'nearest' });
  }, [pageId, open]);

  useEffect(() => {
    document.title = page ? `${page.nav} · 计组复习` : '计组复习';
  }, [page]);

  return (
    <div class="shell" onClick={onLinkClick}>
      <nav id="nav" class={`nav${open ? ' is-open' : ''}`} ref={nav} aria-label="章节">
        <div class="nav-top">
          <a class="nav-home" href="/" aria-current={pageId === null ? 'page' : undefined}>
            计组复习
          </a>
          <button type="button" class="nav-toggle" aria-expanded={open} aria-controls="nav-list" onClick={() => setOpen((value) => !value)}>
            {open ? '收起' : '章节'}
          </button>
        </div>
        <div id="nav-list" class="nav-list">
          {Object.entries(chapters).map(([number, name]) => {
            const items = listed.filter((item) => item.chapter === Number(number));
            if (items.length === 0) return null;
            return (
              <section key={number} class="nav-chapter" aria-labelledby={`nav-ch-${number}`}>
                <h2 id={`nav-ch-${number}`}>
                  <span class="nav-chapter-no">第 {number} 章</span>
                  {name}
                </h2>
                <ul>
                  {items.map((item) => (
                    <li key={item.id}>
                      <a class="nav-link" href={`/${item.id}`} aria-current={item.id === pageId ? 'page' : undefined}>
                        {item.nav}
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </nav>
      <main class="main" id="main" ref={main}>
        <div class="main-inner">{render(pageId)}</div>
        <footer class="foot">
          <p>教材：戴志涛、白中英《计算机组成原理》第七版，科学出版社，2024 年。页码都指这一版。</p>
        </footer>
      </main>
    </div>
  );
}
