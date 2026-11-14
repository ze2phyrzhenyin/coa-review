/**
 * 补间调度。所有场景动画都走这里，所以「立刻到位」只要一句 finishAll()。
 * 缓动只用一族：到达用减速，镜头用先加速后减速，弹跳只给有含义的地方。
 */
export type Ease = (t: number) => number;

export const easeOut: Ease = (t) => 1 - (1 - t) ** 3;
/** 值沿线走：起步快，到达前减速。 */
export const arrive: Ease = (t) => 1 - (1 - t) ** 2.4;
export const easeIn: Ease = (t) => t * t;
export const easeInOut: Ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
export const linear: Ease = (t) => t;
/** 落点略过头再回来。只用于进位跳到左边一列。 */
export const hop: Ease = (t) => {
  const c = 1.70158;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
};

export interface Tween {
  /** 从现在起多久之后开始，毫秒。 */
  delay?: number;
  duration: number;
  ease?: Ease;
  update?: (t: number) => void;
  done?: () => void;
}

interface Item {
  start: number;
  duration: number;
  ease: Ease;
  update: ((t: number) => void) | undefined;
  done: (() => void) | undefined;
  order: number;
}

export class Motion {
  private items: Item[] = [];
  private order = 0;
  /** 有新补间时叫醒渲染循环。 */
  onWake: () => void = () => {};

  get active(): boolean {
    return this.items.length > 0;
  }

  add(tween: Tween): void {
    this.items.push({
      start: performance.now() + (tween.delay ?? 0),
      duration: Math.max(0, tween.duration),
      ease: tween.ease ?? easeOut,
      update: tween.update,
      done: tween.done,
      order: this.order++,
    });
    this.onWake();
  }

  /** 过一会儿做一件事。也会被 finishAll 立刻做完。 */
  after(delay: number, done: () => void): void {
    this.add({ delay, duration: 0, done });
  }

  /** 推进到 now。返回是否还有没做完的。 */
  tick(now: number): boolean {
    for (const item of [...this.items]) {
      if (now < item.start) continue;
      const t = item.duration === 0 ? 1 : Math.min(1, (now - item.start) / item.duration);
      item.update?.(item.ease(t));
      if (t >= 1) {
        this.items.splice(this.items.indexOf(item), 1);
        item.done?.();
      }
    }
    return this.items.length > 0;
  }

  /** 全部立刻到位，按结束时间的先后。做完时新加进来的也一并做完。 */
  finishAll(): void {
    let guard = 0;
    while (this.items.length > 0 && guard++ < 10_000) {
      this.items.sort((a, b) => a.start + a.duration - (b.start + b.duration) || a.order - b.order);
      const item = this.items.shift()!;
      item.update?.(1);
      item.done?.();
    }
  }
}
