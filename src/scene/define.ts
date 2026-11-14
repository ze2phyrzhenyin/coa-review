/**
 * 页面自带部件的登记处。页面在自己的目录里写 parts.ts，用 definePart 登记，场景用 SceneSpec.kinds 按需加载它：
 *
 *   // src/pages/6-arbiter/parts.ts
 *   import { Part, definePart, solid, blockGeometry } from '../../scene/define';
 *   class Baton extends Part<BatonProps> { … }
 *   definePart('6-arbiter:baton', (kit, id, position, props) => new Baton(kit, id, position, props as BatonProps));
 *
 *   // scene.ts
 *   const scene: SceneSpec = { parts: [{ id: 'baton', kind: '6-arbiter:baton', position: [0, 0], props: { … } }], wires: [], kinds: () => import('./parts') };
 *
 * 这个文件引用 three.js：只能在 kinds 加载的模块里引用，页面的 index.tsx、scene.ts 不要静态引用它。
 */
import type { Kit } from './kit';
import type { Part } from './parts/base';
import type { CommonProps, LocalKind, Vec2 } from './types';

export type PartFactory = (kit: Kit, id: string, position: Vec2, props: CommonProps & Record<string, unknown>) => Part<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const registry = new Map<string, PartFactory>();

/** 登记一种页面自带的部件。名字写成 '<页面编号>:<名字>'，不能和内置部件重名。 */
export function definePart(kind: LocalKind, factory: PartFactory): void {
  if (!/^[\w-]+:[\w-]+$/.test(kind)) throw new Error(`部件种类要写成「页面编号:名字」：${kind}`);
  registry.set(kind, factory);
}

export function localPart(kind: string): PartFactory | undefined {
  return registry.get(kind);
}

// 写部件要用到的东西，一处引入。
export { Part, solid } from './parts/base';
export type { Animate, Side } from './parts/base';
export { Card } from './parts/card';
export type { CardKind, CardOptions } from './parts/card';
export { rebound, burst } from './parts/effects';
export { estimateWidth } from './parts/memory';
export { TextPlane, blockGeometry, box, cardGeometry, discGeometry, prismGeometry } from './kit';
export type { Kit, TextTone } from './kit';
export { arrive, easeIn, easeInOut, easeOut, hop, linear } from './motion';
export { sizes, timing } from './theme';
