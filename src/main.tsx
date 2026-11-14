import { render } from 'preact';
import type { ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { Home } from './app/Home';
import { Shell } from './app/Shell';
import { pages } from './content/pages';
// 顺序有意义：变量、元素默认样式、共用控件、外壳。页面和播放器的样式随页面按需加载，排在后面，能盖过这些。
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './app/shell.css';
import './app/home.css';

/**
 * 页面实现按目录约定登记：src/pages/<编号>/index.tsx，默认导出一个组件。
 * 每页单独打包、按需加载；qa 脚本也按这个约定找「已实现的页面」。
 */
const implementations = import.meta.glob<{ default: ComponentType }>('./pages/*/index.tsx');
const loaderFor = (id: string) => implementations[`./pages/${id}/index.tsx`];

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
