/**
 * 场景库的入口。这里导出的都不引用 three.js；三维部分用 loadRuntime() 按需加载。
 * 约定见 specs/_scene-contract.md。
 */
export * from './types';
export * from './theme';
export { bindTable, frameAt, from, hashPose, poseAt, revealedRows } from './pose';
export type { PoseInput } from './pose';
export type { Rect } from './stage';
export type { SceneView } from './view';

export const loadRuntime = () => import('./runtime');

/** 这台设备能不能用三维场景。只有软件渲染时也算不能，改用平面模式。 */
export function canUseWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: true });
    if (!context) return false;
    context.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}
