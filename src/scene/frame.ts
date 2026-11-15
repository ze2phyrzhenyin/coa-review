/**
 * 候选框（等学生点选时的四个角）画在哪。纯函数，不引用 three.js。
 * 矮的部件（寄存器、门）框在台面上，围着占地；立着一块板的部件（存储阵列、时空格、时间轴、
 * 页面自带的栏）框在板所在的平面上，从底座一直围到板顶，整件都在框里。
 */
export interface PickFrame {
  /** table：贴在台面上，w × d 围着占地中心。face：在正对屏幕的平面上，w × h，底边在 y0（相对 face 的原点）。 */
  plane: 'table' | 'face';
  w: number;
  /** table 时是深（z 方向），face 时是高（y 方向）。 */
  h: number;
  y0: number;
}

const MARGIN = 0.2;

export function pickFrameOf(footprint: { w: number; d: number }, faceWidth: number, faceHeight: number, faceY = 0.3): PickFrame {
  const w = Math.max(footprint.w, faceWidth) + MARGIN * 2;
  // 板比占地的进深还高：台面上的框只能围住底座，改到板的平面上围整件。
  if (faceHeight > footprint.d * 1.25) return { plane: 'face', w, h: faceHeight + faceY + MARGIN * 2, y0: -faceY - MARGIN };
  return { plane: 'table', w: footprint.w + MARGIN * 2, h: footprint.d + MARGIN * 2, y0: 0 };
}
