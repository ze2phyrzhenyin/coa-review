import { useEffect, useState } from 'preact/hooks';

/** 路径路由：/ 是首页，/<页面编号> 是页面。查询参数留给页面状态（见 src/lib/url-state.ts）。 */
export function currentPath(): string {
  return decodeURIComponent(location.pathname.replace(/\/+$/, '')) || '/';
}

const listeners = new Set<() => void>();

export function navigate(path: string): void {
  if (path === location.pathname + location.search) return;
  history.pushState(null, '', path);
  for (const listener of listeners) listener();
}

export function usePath(): string {
  const [path, setPath] = useState(currentPath);
  useEffect(() => {
    const update = () => setPath(currentPath());
    listeners.add(update);
    addEventListener('popstate', update);
    return () => {
      listeners.delete(update);
      removeEventListener('popstate', update);
    };
  }, []);
  return path;
}

/** 站内链接走前端路由；带修饰键或新窗口的点击交还浏览器。 */
export function onLinkClick(event: MouseEvent): void {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const anchor = (event.target as Element | null)?.closest('a');
  if (!anchor || anchor.target || anchor.origin !== location.origin) return;
  event.preventDefault();
  navigate(anchor.pathname + anchor.search);
}
