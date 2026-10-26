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

// Geometry and materials are shared between every figure, so a full roster stays cheap.
const geoCache = new Map<string, THREE.BufferGeometry>();
const matCache = new Map<string, THREE.MeshStandardMaterial>();

function geo(key: string, make: () => THREE.BufferGeometry) {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    g.userData.shared = true;
    geoCache.set(key, g);
  }
  return g;
}
function mat(color: number, rough = 0.75, metal = 0.02) {
  const key = `${color}|${rough}|${metal}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
    m.userData.shared = true;
    matCache.set(key, m);
  }
  return m;
}

function part(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.scale.set(sx, sy, sz);
  return o;
}
const sphere = (r: number) => geo(`s${r}`, () => new THREE.SphereGeometry(r, 18, 14));
const capsule = (r: number, len: number) => geo(`c${r}|${len}`, () => new THREE.CapsuleGeometry(r, len, 6, 14));

/** A smooth torso: narrow hips, broader chest, rounded shoulders. */
function torsoGeo(bulk: number, chest: number) {
  return geo(`torso${bulk}|${chest}`, () => {
    const pts = [
      [0.0, 0.84],
      [0.14, 0.86],
      [0.17 * bulk, 0.98],
      [0.175 * bulk, 1.13],
      [0.19 * chest, 1.3],
      [0.225 * chest, 1.42],
      [0.2 * chest, 1.52],
      [0.11, 1.6],
      [0.0, 1.62],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    return new THREE.LatheGeometry(pts, 28);
  });
}

function limb(parent: THREE.Group, x: number, y: number, radius: number, length: number, color: number, endColor: number, endScale: [number, number, number], rough = 0.8) {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, 0);
  pivot.add(part(capsule(radius, length), mat(color, rough), 0, -(length / 2 + radius * 0.6), 0));
  const end = part(sphere(radius * 1.15), mat(endColor, rough), 0, -(length + radius * 1.5), endScale[2] > 1 ? radius * 0.6 : 0, endScale[0], endScale[1], endScale[2]);
  pivot.add(end);
  parent.add(pivot);
  return pivot;
}

function eyes(head: THREE.Group, x: number, y: number, z: number, r: number) {
  for (const s of [-1, 1]) {
    head.add(part(sphere(r), mat(0xffffff, 0.3), s * x, y, z));
    head.add(part(sphere(r * 0.55), mat(0x0b0f19, 0.2), s * x, y, z + r * 0.62));
    head.add(part(sphere(r * 0.18), mat(0xffffff, 0.1), s * x + r * 0.15, y + r * 0.2, z + r * 1.05));
  }
}

function tube(points: THREE.Vector3[], radius: number, color: number) {
  const curve = new THREE.CatmullRomCurve3(points);
  const g = new THREE.TubeGeometry(curve, 18, radius, 10, false);
  const m = part(g, mat(color, 0.45));
  const tip = curve.getPoint(1);
  const dir = curve.getTangent(1).normalize();
  const cone = new THREE.Mesh(new THREE.ConeGeometry(radius, radius * 3.4, 10), mat(color, 0.45));
  cone.position.copy(tip).addScaledVector(dir, radius * 1.5);
  cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  const grp = new THREE.Group();
  grp.add(m, cone);
  return grp;
}

function humanHead(g: THREE.Group, skin: number, hair: number) {
  const head = new THREE.Group();
  head.position.set(0, 1.77, 0.01);
  head.add(part(sphere(0.15), mat(skin, 0.6), 0, 0, 0, 0.93, 1.12, 1.0));
  // hair cap
  head.add(part(geo('hair', () => new THREE.SphereGeometry(0.16, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55)), mat(hair, 0.85), 0, 0.01, -0.012, 0.97, 1.12, 1.04));
  head.add(part(sphere(0.045), mat(hair, 0.85), 0, 0.06, -0.15, 1.8, 1.0, 1.0)); // back of hair
  eyes(head, 0.057, 0.015, 0.128, 0.026);
  head.add(part(sphere(0.026), mat(skin, 0.6), 0, -0.025, 0.15, 1, 1.1, 1)); // nose
  head.add(part(capsule(0.008, 0.05), mat(0x7a2d2d, 0.5), 0, -0.07, 0.135).rotateZ(Math.PI / 2)); // mouth
  for (const s of [-1, 1]) head.add(part(sphere(0.03), mat(skin, 0.6), s * 0.14, -0.005, 0, 0.6, 1, 0.9));
  g.add(head);
  g.add(part(geo('neck', () => new THREE.CylinderGeometry(0.055, 0.065, 0.12, 14)), mat(skin, 0.6), 0, 1.62, 0));
}

function bullHead(g: THREE.Group, coat: number, snout: number, accent: number) {
  const head = new THREE.Group();
  head.position.set(0, 1.8, 0.03);
  head.add(part(sphere(0.19), mat(coat, 0.9), 0, 0, 0, 1.0, 1.05, 1.1));
  head.add(part(sphere(0.07), mat(0x3a2414, 0.95), 0, 0.2, 0.0, 1.4, 0.8, 1.2)); // forelock tuft
  // muzzle with nostrils and a gold ring
  head.add(part(capsule(0.095, 0.08), mat(snout, 0.7), 0, -0.08, 0.2).rotateX(Math.PI / 2));
  for (const s of [-1, 1]) head.add(part(sphere(0.018), mat(0x2a1a12, 0.5), s * 0.04, -0.07, 0.292));
  const ring = new THREE.Mesh(geo('nring', () => new THREE.TorusGeometry(0.045, 0.009, 8, 20)), mat(0xf5c542, 0.25, 0.8));
  ring.position.set(0, -0.14, 0.285);
  head.add(ring);
  eyes(head, 0.083, 0.045, 0.158, 0.033);
  for (const s of [-1, 1]) {
    head.add(part(sphere(0.04), mat(0x3a2414, 0.9), s * 0.085, 0.09, 0.165, 1.5, 0.6, 1.0)); // brow
    const ear = part(sphere(0.07), mat(coat, 0.9), s * 0.2, 0.03, -0.02, 1.7, 0.55, 0.9);
    ear.rotation.z = -s * 0.35;
    head.add(ear);
    const horn = tube(
      [new THREE.Vector3(s * 0.13, 0.12, 0.0), new THREE.Vector3(s * 0.27, 0.15, 0.0), new THREE.Vector3(s * 0.37, 0.28, 0.02), new THREE.Vector3(s * 0.36, 0.43, 0.07), new THREE.Vector3(s * 0.29, 0.5, 0.11)],
      0.034,
      0xf3ead2,
    );
    head.add(horn);
  }
  g.add(head);
  g.add(part(geo('bneck', () => new THREE.CylinderGeometry(0.09, 0.12, 0.14, 14)), mat(coat, 0.9), 0, 1.62, 0));
  const scarf = new THREE.Mesh(geo('scarf', () => new THREE.TorusGeometry(0.15, 0.04, 10, 24)), mat(accent, 0.6));
  scarf.rotation.x = Math.PI / 2;
  scarf.position.set(0, 1.57, 0.01);
  g.add(scarf);
}

function bearHead(g: THREE.Group, coat: number, snout: number, accent: number) {
  const head = new THREE.Group();
  head.position.set(0, 1.8, 0.02);
  head.add(part(sphere(0.2), mat(coat, 0.95), 0, 0, 0, 1.05, 1.0, 1.0));
  head.add(part(sphere(0.105), mat(snout, 0.8), 0, -0.06, 0.16, 1.0, 0.85, 0.95));
  head.add(part(sphere(0.034), mat(0x1a1210, 0.35), 0, -0.02, 0.25, 1.3, 0.9, 0.9));
  head.add(part(capsule(0.006, 0.05), mat(0x1a1210, 0.4), 0, -0.1, 0.24).rotateZ(Math.PI / 2));
  eyes(head, 0.075, 0.06, 0.16, 0.026);
  for (const s of [-1, 1]) {
    head.add(part(sphere(0.075), mat(coat, 0.95), s * 0.155, 0.17, -0.01));
    head.add(part(sphere(0.045), mat(0xc98f86, 0.8), s * 0.155, 0.17, 0.03));
  }
  g.add(head);
  g.add(part(geo('beneck', () => new THREE.CylinderGeometry(0.085, 0.11, 0.14, 14)), mat(coat, 0.95), 0, 1.62, 0));
  const scarf = new THREE.Mesh(geo('scarf', () => new THREE.TorusGeometry(0.15, 0.04, 10, 24)), mat(accent, 0.6));
  scarf.rotation.x = Math.PI / 2;
  scarf.position.set(0, 1.57, 0.01);
  g.add(scarf);
}

/**
 * Smooth, rounded figures about 1.75 units tall, facing +z.
 * human: the player. bull / bear: what the player becomes once a side is picked.
 */
export function makeCharacter(form: Form): Character {
  const group = new THREE.Group();

  const skin = 0xd9a47a;
  if (form === 'human') {
    const shirt = mat(0x3b6fd8, 0.8);
    const torso = part(torsoGeo(1, 1), shirt, 0, 0, 0, 1, 1, 0.66);
    group.add(torso);
    for (const s of [-1, 1]) group.add(part(sphere(0.07), shirt, s * 0.255, 1.5, 0));
    humanHead(group, skin, 0x2b1b12);
    const legL = limb(group, -0.1, 0.92, 0.09, 0.6, 0x23304d, 0xf4f4f4, [1, 0.7, 1.7], 0.85);
    const legR = limb(group, 0.1, 0.92, 0.09, 0.6, 0x23304d, 0xf4f4f4, [1, 0.7, 1.7], 0.85);
    const armL = limb(group, -0.28, 1.5, 0.058, 0.42, 0x3b6fd8, skin, [1, 1, 1], 0.7);
    const armR = limb(group, 0.28, 1.5, 0.058, 0.42, 0x3b6fd8, skin, [1, 1, 1], 0.7);
    return { group, form, legL, legR, armL, armR };
  }

  const bull = form === 'bull';
  const coat = bull ? 0x6b4226 : 0x5e4030;
  const snout = bull ? 0xd8b896 : 0xcfb59a;
  const accent = bull ? 0x10b981 : 0xf43f5e;
  const fur = mat(coat, 0.95);
  group.add(part(torsoGeo(bull ? 1.2 : 1.25, bull ? 1.3 : 1.2), fur, 0, 0, 0, 1, 1, 0.78));
  group.add(part(sphere(0.2), mat(bull ? 0x8a5a38 : 0x7a5640, 0.95), 0, 1.12, 0.1, 1.15, 1.5, 0.75)); // lighter belly
  for (const s of [-1, 1]) group.add(part(sphere(bull ? 0.115 : 0.1), fur, s * (bull ? 0.31 : 0.29), 1.5, 0));
  if (bull) bullHead(group, coat, snout, accent);
  else bearHead(group, coat, snout, accent);

  const legL = limb(group, -0.12, 0.9, bull ? 0.11 : 0.115, 0.55, coat, bull ? 0x2a1a12 : coat, bull ? [1, 0.75, 1.5] : [1.1, 0.7, 1.6]);
  const legR = limb(group, 0.12, 0.9, bull ? 0.11 : 0.115, 0.55, coat, bull ? 0x2a1a12 : coat, bull ? [1, 0.75, 1.5] : [1.1, 0.7, 1.6]);
  const armL = limb(group, bull ? -0.36 : -0.34, 1.5, 0.085, 0.4, coat, bull ? 0x2a1a12 : coat, [1, 1, 1]);
  const armR = limb(group, bull ? 0.36 : 0.34, 1.5, 0.085, 0.4, coat, bull ? 0x2a1a12 : coat, [1, 1, 1]);
  return { group, form, legL, legR, armL, armR };
}

/** Swing legs and arms. `moving` 0..1, `t` seconds. */
export function animateWalk(c: Character, t: number, moving: number) {
  const s = Math.sin(t * 10) * 0.7 * moving;
  c.legL.rotation.x = s;
  c.legR.rotation.x = -s;
  c.armL.rotation.x = -s * 0.8;
  c.armR.rotation.x = s * 0.8;
  c.group.position.y = Math.abs(Math.sin(t * 10)) * 0.04 * moving;
}

/**
 * Body of a puller: leans back with effort, plants its feet, and steps when the rope drags the team.
 * `step` 0..1 is how fast the team is moving; `dragged` means this team is losing ground.
 */
export function pullPose(c: Character, t: number, lean: number, phase: number, step = 0, dragged = false) {
  c.group.rotation.order = 'YXZ';
  c.group.rotation.x = -0.14 - lean * 0.3 + (dragged ? 0.14 : 0);
  const s = Math.sin(t * 9 + phase) * 0.55 * step;
  c.legL.rotation.x = 0.35 + s;
  c.legR.rotation.x = -0.25 - s;
  c.group.position.y = Math.abs(Math.sin(t * 9 + phase)) * 0.05 * step + Math.sin(t * 7 + phase) * 0.015 * (0.5 + lean);
}

/** Points an arm at a spot given in the coordinates of the figure's parent (so the hand grips it). */
export function aimArm(c: Character, arm: THREE.Object3D, target: THREE.Vector3) {
  c.group.updateMatrix();
  const local = target.clone().applyMatrix4(c.group.matrix.clone().invert());
  const dir = local.sub(arm.position);
  if (dir.lengthSq() < 1e-6) return;
  arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.normalize());
}

export function disposeObject(o: THREE.Object3D) {
  o.traverse((n) => {
    const m = n as THREE.Mesh;
    if (m.geometry && !m.geometry.userData.shared) m.geometry.dispose();
    const mm = m.material as THREE.Material | THREE.Material[] | undefined;
    const kill = (x: THREE.Material) => {
      if (x.userData.shared) return;
      const tex = (x as THREE.MeshBasicMaterial).map;
      if (tex) tex.dispose();
      x.dispose();
    };
    if (Array.isArray(mm)) mm.forEach(kill);
    else if (mm) kill(mm);
  });
}
