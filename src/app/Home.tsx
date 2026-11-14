import { useState } from 'preact/hooks';
import { chapters, pages, visiblePages } from '../content/pages';
import { readLast } from './last-visit';

/**
 * 每页对应的教材页码。页面清单（src/content/pages.ts）还没有这一栏，先放在这里；
 * 加进清单以后删掉这张表。
 */
const textbookPages: Record<string, string> = {
  '2-overflow': 'p37–38',
  '3-cache-run': 'p100–109',
  '5-cycle': 'p152–161',
};

/** 首页：上次学到哪里，和按教材章节排的目录。每页一行：短名、它回答的问题、教材页码。 */
export function Home() {
  const listed = visiblePages();
  // 只在首次渲染读一次；读不到（隐私模式、没来过）就不显示这一行。
  const [last] = useState(readLast);
  const lastPage = last ? pages.find((page) => page.id === last.id && listed.includes(page)) : undefined;

  return (
    <>
      <h1>计算机组成原理</h1>
      {last && lastPage && (
        <div class="home-last">
          <span class="home-last-label">上次学到</span>
          <a class="home-last-link" href={`/${lastPage.id}${last.search}`}>
            <span class="home-last-name">{lastPage.nav}</span>
            {(last.tab || last.step) && (
              <span class="home-last-where">
                {[last.tab, last.step ? `第 ${last.step} 步` : ''].filter(Boolean).join('，')}
              </span>
            )}
          </a>
        </div>
      )}
      <ol class="toc">
        {Object.entries(chapters).map(([number, name]) => {
          const items = listed.filter((item) => item.chapter === Number(number));
          return (
            // 还没有页面的章只留章名，字是灰的，不能点。
            <li key={number} class={`toc-chapter${items.length === 0 ? ' is-empty' : ''}`}>
              <h2 class="toc-head">
                <span class="toc-no">第 {number} 章</span>
                <span class="toc-name">{name}</span>
              </h2>
              {items.length > 0 && (
                <ul class="toc-pages">
                  {items.map((item) => (
                    <li key={item.id}>
                      <a class="toc-link" href={`/${item.id}`}>
                        <span class="toc-nav">{item.nav}</span>
                        <span class="toc-q">{item.title}</span>
                        {textbookPages[item.id] && <span class="toc-ref">教材 {textbookPages[item.id]}</span>}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </>
  );
}
