import * as THREE from 'three';

/** A flat sign that draws itself on a canvas, so real text and numbers can be shown in the 3D room. */
export interface Panel {
  mesh: THREE.Mesh;
  redraw: () => void;
}

export function makePanel(width: number, height: number, px: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, transparent = false): Panel {
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = Math.round((px * height) / width);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const material = new THREE.MeshBasicMaterial({ map: tex, transparent, toneMapped: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  const redraw = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    draw(ctx, canvas.width, canvas.height);
    tex.needsUpdate = true;
  };
  redraw();
  return { mesh, redraw };
}

export const money = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: n < 1 ? 6 : n < 100 ? 3 : 2 })}`;
export const clock = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, Math.floor(s)) % 60).padStart(2, '0')}`;
