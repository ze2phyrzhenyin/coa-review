import { useEffect, useState } from 'preact/hooks';

/** 媒体查询的当前结果，变了就重新渲染。 */
export function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof matchMedia === 'function' && matchMedia(query).matches);
  useEffect(() => {
    const media = matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);
  return matches;
}

/** 窄屏（手机竖屏）：场景换成更紧凑的版式。 */
export const useNarrow = (): boolean => useMedia('(max-width: 600px)');
