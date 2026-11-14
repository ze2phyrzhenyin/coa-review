import { useEffect } from 'preact/hooks';
import { pages } from '../content/pages';
import { URL_STATE_EVENT } from './url-state';

/**
 * 「上次学到」：最后看的页面和网址里的状态（标签页、步数、例题）。只存在这台设备的浏览器里；
 * 隐私模式、禁用存储时读写都会抛错，一律当作没有记录。
 */
const KEY = 'coa:last';

export interface LastVisit {
  id: string;
  /** 网址的查询串，原样带回去就回到同一画面。 */
  search: string;
  /** 当时选中的标签页名字（讲解、试一试……）。 */
  tab?: string | undefined;
  /** 播放器的步数，0 不记。 */
  step?: number | undefined;
}

export function parseLast(raw: string | null): LastVisit | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<LastVisit>;
    if (typeof value.id !== 'string' || !pages.some((page) => page.id === value.id)) return null;
    const search = typeof value.search === 'string' && (value.search === '' || value.search.startsWith('?')) ? value.search : '';
    const tab = typeof value.tab === 'string' && value.tab.length <= 12 ? value.tab : undefined;
    const step = Number.isInteger(value.step) && (value.step as number) > 0 ? (value.step as number) : undefined;
    return { id: value.id, search, tab, step };
  } catch {
    return null;
  }
}

export function readLast(): LastVisit | null {
  try {
    return parseLast(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

function saveLast(visit: LastVisit): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(visit));
  } catch {
    // 存不下就不记，不影响页面。
  }
}

/** 在页面上时，换标签页、走步、改参数后记一次（稍等一下，连按时只记最后一次）。 */
export function useRecordVisit(pageId: string | null): void {
  useEffect(() => {
    if (!pageId || !pages.some((page) => page.id === pageId)) return;
    const home = location.pathname;
    let timer = 0;
    const record = () => {
      if (location.pathname !== home) return;
      const params = new URLSearchParams(location.search);
      const step = Number(params.get('s'));
      const tab = document.querySelector('#main [role="tab"][aria-selected="true"]')?.textContent?.trim();
      saveLast({ id: pageId, search: location.search, tab: tab || undefined, step: Number.isInteger(step) && step > 0 ? step : undefined });
    };
    const later = () => {
      clearTimeout(timer);
      timer = window.setTimeout(record, 400);
    };
    later();
    addEventListener(URL_STATE_EVENT, later);
    addEventListener('popstate', later);
    return () => {
      clearTimeout(timer);
      removeEventListener(URL_STATE_EVENT, later);
      removeEventListener('popstate', later);
    };
  }, [pageId]);
}
