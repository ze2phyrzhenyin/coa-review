import { useCallback, useEffect, useRef, useState } from 'preact/hooks';

/**
 * 视图状态（步数、参数、所选例题、标签页）放在查询串里：刷新、分享、浏览器返回都回到同一画面。
 * 写入用 replaceState，不往历史里塞每一步；值等于缺省值时从网址里去掉。
 */
const CHANGED = 'coa:url-state';

function read(name: string, fallback: string): string {
  return new URLSearchParams(location.search).get(name) ?? fallback;
}

type Update = string | ((previous: string) => string);

export function useParam(name: string, fallback: string): [string, (next: Update) => void] {
  const [value, setValue] = useState(() => read(name, fallback));
  // 连按时下一次要基于上一次的结果，不等重新渲染。
  const latest = useRef(value);
  latest.current = value;

  useEffect(() => {
    const sync = () => {
      const current = read(name, fallback);
      latest.current = current;
      setValue(current);
    };
    sync();
    addEventListener('popstate', sync);
    addEventListener(CHANGED, sync);
    return () => {
      removeEventListener('popstate', sync);
      removeEventListener(CHANGED, sync);
    };
  }, [name, fallback]);

  const set = useCallback(
    (next: Update) => {
      const resolved = typeof next === 'function' ? next(latest.current) : next;
      if (resolved === latest.current && resolved === read(name, fallback)) return;
      latest.current = resolved;
      const url = new URL(location.href);
      if (resolved === fallback) url.searchParams.delete(name);
      else url.searchParams.set(name, resolved);
      history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
      setValue(resolved);
      // 同一页里读同一个参数的其他组件跟着更新。
      dispatchEvent(new Event(CHANGED));
    },
    [name, fallback],
  );

  return [value, set];
}

/** 整数参数：非法值或越界时落回范围内。 */
export function useIntParam(name: string, fallback: number, min: number, max: number): [number, (next: number | ((previous: number) => number)) => void] {
  const [raw, setRaw] = useParam(name, String(fallback));
  const clamp = (n: number) => Math.min(max, Math.max(min, Number.isFinite(n) ? Math.trunc(n) : fallback));
  const value = clamp(Number(raw));
  const set = useCallback(
    (next: number | ((previous: number) => number)) => {
      setRaw((previous) => {
        const before = clamp(Number(previous));
        return String(clamp(typeof next === 'function' ? next(before) : next));
      });
    },
    // clamp 只依赖这四个数。
    [setRaw, fallback, min, max],
  );
  return [value, set];
}
