import * as THREE from 'three';

export type Form = 'human' | 'bull' | 'bear';

export interface Character {
  group: THREE.Group;
  form: Form;
  legL: THREE.Object3D;
  legR: THREE.Object3D;
  armL: THREE.Object3D;
  armR: THREE.Object3D;
}

const mat = (color: number, rough = 0.7) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.05 });

function box(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  o.position.set(x, y, z);
  return o;
}
function ball(r: number, m: THREE.Material, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) {
  const o = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), m);
  o.position.set(x, y, z);
  o.scale.set(sx, sy, sz);
  return o;
}

/** A limb hangs from a pivot at its top so rotating the pivot swings it. */
function limb(w: number, len: number, m: THREE.Material, x: number, y: number) {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, 0);
  pivot.add(box(w, len, w, m, 0, -len / 2, 0));
  return pivot;
}

/**
 * Chunky low-poly figures, all about 1.7 units tall and facing +z.
 * human: the player. bull / bear: what the player becomes once a side is picked.
 */
export function makeCharacter(form: Form): Character {
  const group = new THREE.Group();
  const skin = mat(0xf1c9a5);
  const dark = mat(0x1f2937);

  let bodyMat: THREE.Material;
  let limbMat: THREE.Material;
  if (form === 'human') {
    bodyMat = mat(0x3b82f6);
    limbMat = mat(0x1e3a8a);
  } else if (form === 'bull') {
    bodyMat = mat(0x6b3f23);
    limbMat = mat(0x4a2a15);
  } else {
    bodyMat = mat(0x5b3a29);
    limbMat = mat(0x3d261a);
  }

  const legL = limb(0.3, 0.8, limbMat, -0.2, 0.8);
  const legR = limb(0.3, 0.8, limbMat, 0.2, 0.8);
  const armL = limb(0.24, 0.75, form === 'human' ? skin : limbMat, -0.5, 1.45);
  const armR = limb(0.24, 0.75, form === 'human' ? skin : limbMat, 0.5, 1.45);
  group.add(legL, legR, armL, armR);
  group.add(box(0.8, 0.8, 0.45, bodyMat, 0, 1.2, 0));

  if (form === 'human') {
    group.add(ball(0.28, skin, 0, 1.85, 0));
    group.add(ball(0.3, mat(0x2b1b12), 0, 1.93, -0.03, 1, 0.7, 1));
    group.add(box(0.06, 0.06, 0.04, dark, -0.1, 1.88, 0.26));
    group.add(box(0.06, 0.06, 0.04, dark, 0.1, 1.88, 0.26));
  } else if (form === 'bull') {
    const head = new THREE.Group();
    head.position.set(0, 1.85, 0.02);
    head.add(ball(0.34, mat(0x7a4a2b), 0, 0, 0, 1.05, 0.95, 1));
    head.add(box(0.36, 0.22, 0.26, mat(0xd9b99b), 0, -0.1, 0.3));
    head.add(ball(0.045, dark, -0.09, -0.08, 0.43));
    head.add(ball(0.045, dark, 0.09, -0.08, 0.43));
    head.add(box(0.07, 0.07, 0.04, dark, -0.15, 0.08, 0.3));
    head.add(box(0.07, 0.07, 0.04, dark, 0.15, 0.08, 0.3));
    const horn = mat(0xf5ecd0, 0.4);
    for (const s of [-1, 1]) {
      const h1 = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.4, 10), horn);
      h1.position.set(0.38 * s, 0.14, 0);
      h1.rotation.z = -s * 1.15;
      const h2 = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.26, 10), horn);
      h2.position.set(0.58 * s, 0.34, 0);
      h2.rotation.z = -s * 0.35;
      head.add(h1, h2);
    }
    group.add(head);
    group.add(box(0.82, 0.14, 0.5, mat(0x10b981), 0, 1.2, 0)); // green sash
  } else {
    const head = new THREE.Group();
    head.position.set(0, 1.85, 0.02);
    const fur = mat(0x6e4a37);
    head.add(ball(0.34, fur, 0, 0, 0));
    head.add(ball(0.12, fur, -0.26, 0.28, 0));
    head.add(ball(0.12, fur, 0.26, 0.28, 0));
    head.add(ball(0.2, mat(0xd2b49b), 0, -0.1, 0.24, 1, 0.8, 0.8));
    head.add(ball(0.05, dark, 0, -0.05, 0.42));
    head.add(ball(0.04, dark, -0.12, 0.06, 0.3));
    head.add(ball(0.04, dark, 0.12, 0.06, 0.3));
    group.add(head);
    group.add(box(0.82, 0.14, 0.5, mat(0xf43f5e), 0, 1.2, 0)); // red sash
  }

  group.traverse((o) => {
    o.castShadow = false;
  });
  return { group, form, legL, legR, armL, armR };
}

/** Swing legs and arms. `moving` 0..1, `t` seconds. */
export function animateWalk(c: Character, t: number, moving: number) {
  const s = Math.sin(t * 10) * 0.7 * moving;
  c.legL.rotation.x = s;
  c.legR.rotation.x = -s;
  c.armL.rotation.x = -s * 0.8;
  c.armR.rotation.x = s * 0.8;
}

/** Both arms forward, gripping the rope. `lean` is how hard they pull (0..1). */
export function pullPose(c: Character, t: number, lean: number, phase: number) {
  c.armL.rotation.x = -1.35;
  c.armR.rotation.x = -1.35;
  c.group.rotation.x = -0.12 - lean * 0.22;
  c.legL.rotation.x = 0.35;
  c.legR.rotation.x = -0.25;
  c.group.position.y = Math.sin(t * 7 + phase) * 0.02 * (0.5 + lean);
}

export function disposeObject(o: THREE.Object3D) {
  o.traverse((n) => {
    const m = n as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mm = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mm)) mm.forEach((x) => x.dispose());
    else if (mm) {
      const tex = (mm as THREE.MeshBasicMaterial).map;
      if (tex) tex.dispose();
      mm.dispose();
    }
  });
}
