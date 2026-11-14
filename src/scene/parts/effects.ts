/**
 * 共用的小动作：落定时的一下回弹、撞车时的碎片。只在有含义的那一下用（docs/INTERACTION.md「编排」）。
 */
import { Mesh, Vector3 } from 'three';
import type { MeshLambertMaterial, Object3D } from 'three';
import { boxGeometry } from '../kit';
import type { Kit } from '../kit';

/** 落定：往下压一点再回来，只弹一次。axis 是被压的方向，默认 y。 */
export function rebound(kit: Kit, object: Object3D, amount = 0.05, delay = 0, axis: 'x' | 'y' | 'z' = 'y'): void {
  if (kit.reduced) return;
  let base: number | null = null;
  kit.motion.add({
    delay,
    duration: 240,
    ease: (t) => t,
    update: (t) => {
      if (base === null) base = object.position[axis];
      // 先压下去，回来时略过头一点，再停住。
      object.position[axis] = base - amount * Math.sin(Math.PI * 2 * t) * (1 - t) * 1.4;
      kit.invalidate();
    },
    done: () => {
      if (base !== null) object.position[axis] = base;
    },
  });
}

/** 撞车：从 at（父对象的局部坐标）向四周崩出几片碎片，落下、淡出，然后清掉。 */
export function burst(kit: Kit, parent: Object3D, at: Vector3, count = 10): void {
  if (kit.reduced) return;
  const material = (kit.mats.accent as MeshLambertMaterial).clone();
  material.transparent = true;
  const pieces: { mesh: Mesh; v: Vector3; spin: number }[] = [];
  for (let i = 0; i < count; i++) {
    const mesh = new Mesh(boxGeometry(), material);
    const s = 0.07 + ((i * 37) % 5) * 0.012;
    mesh.scale.set(s, s * 0.5, s);
    mesh.position.copy(at);
    const angle = (i / count) * Math.PI * 2 + 0.3;
    const speed = 1.6 + ((i * 53) % 7) * 0.18;
    pieces.push({ mesh, v: new Vector3(Math.cos(angle) * speed, 1.8 + ((i * 29) % 4) * 0.35, Math.sin(angle) * speed * 0.6), spin: ((i % 3) - 1) * 9 });
    parent.add(mesh);
  }
  const duration = 520;
  kit.motion.add({
    duration,
    ease: (t) => t,
    update: (t) => {
      const s = (t * duration) / 1000;
      for (const piece of pieces) {
        piece.mesh.position.set(at.x + piece.v.x * s, Math.max(0.02, at.y + piece.v.y * s - 4.9 * s * s), at.z + piece.v.z * s);
        piece.mesh.rotation.set(piece.spin * s, piece.spin * s * 0.7, 0);
      }
      material.opacity = 1 - t * t;
      kit.invalidate();
    },
    done: () => {
      for (const piece of pieces) piece.mesh.removeFromParent();
      material.dispose();
      kit.invalidate();
    },
  });
}
