import { render } from 'preact';
import type { ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { Shell } from './app/Shell';
import { chapters, pages, visiblePages } from './content/pages';
import './app/shell.css';

/**
 * 页面实现按目录约定登记：src/pages/<编号>/index.tsx，默认导出一个组件。
 * 每页单独打包、按需加载；qa 脚本也按这个约定找「已实现的页面」。
 */
const implementations = import.meta.glob<{ default: ComponentType }>('./pages/*/index.tsx');
const loaderFor = (id: string) => implementations[`./pages/${id}/index.tsx`];

function Home() {
  const listed = visiblePages();
  return (
    <>
      <h1>计算机组成原理</h1>
      <p>白中英第七版，第 1–6、8 章。</p>
      {Object.entries(chapters).map(([number, name]) => {
        const items = listed.filter((item) => item.chapter === Number(number));
        if (items.length === 0) return null;
        return (
          <section key={number}>
            <h2>
              第 {number} 章 {name}
            </h2>
            <ul class="home-list">
              {items.map((item) => (
                <li key={item.id}>
                  <a href={`/${item.id}`}>{item.title}</a>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}

function Page({ id }: { id: string }) {
  const meta = pages.find((item) => item.id === id);
  const [View, setView] = useState<ComponentType | null>(null);

  useEffect(() => {
    let current = true;
    setView(null);
    const load = loaderFor(id);
    if (load) void load().then((module) => current && setView(() => module.default));
    return () => {
      current = false;
    };
  }, [id]);

  if (!meta) return <h1>没有这一页</h1>;
  return (
    <>
      <h1>{meta.title}</h1>
      {View ? <View /> : null}
    </>
  );
}

render(<Shell render={(id) => (id === null ? <Home /> : <Page id={id} />)} />, document.getElementById('app')!);
