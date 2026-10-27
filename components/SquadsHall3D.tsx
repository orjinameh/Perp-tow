'use client';

import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { SquadMatch } from '@/lib/squads';

interface Props {
  matches: SquadMatch[]; // newest first
  size: number;
  me: string | null;
  now: number;
  selected: SquadMatch | null; // the room you are seated in or inspecting
  onJoinRing: () => void; // "Join a match": the page opens the list modal
  onOpenRing: () => void; // "Open a new match room"
}

const TEAM_COLOR = { 0: 0xbfc5d0, 1: 0xef4444, 2: 0x3b82f6 } as const;

function label(text: string[], w = 512, h = 128, bg = '#111827'): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = '#e5e7eb'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const step = h / (text.length + 1);
  text.forEach((t, i) => { g.font = `${i === 0 ? 'bold ' : ''}${Math.floor(step * 0.6)}px sans-serif`; g.fillText(t, w / 2, step * (i + 1)); });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A click-driven 3D hall: two rings on the floor (join / open), a wall of the 10 newest matches, and the seat ring of your room. */
export const SquadsHall3D: React.FC<Props> = (props) => {
  const host = useRef<HTMLDivElement>(null);
  const live = useRef(props);
  live.current = props;
  const sync = useRef<() => void>(() => {});

  useEffect(() => {
    const el = host.current!;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1020);
    const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    cam.position.set(0, 5.5, 11);
    cam.lookAt(0, 2, 0);
    const r = new THREE.WebGLRenderer({ antialias: true });
    r.setPixelRatio(Math.min(2, window.devicePixelRatio));
    el.appendChild(r.domElement);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x223, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2); sun.position.set(4, 10, 6); scene.add(sun);

    const floor = new THREE.Mesh(new THREE.CircleGeometry(14, 48), new THREE.MeshStandardMaterial({ color: 0x1f2937 }));
    floor.rotation.x = -Math.PI / 2; scene.add(floor);

    const ring = (x: number, color: number, text: string[]) => {
      const g = new THREE.Group(); g.position.set(x, 0.02, 3);
      const m = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.7, 48), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
      m.rotation.x = -Math.PI / 2; m.userData.hit = true; g.add(m);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(1.2, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, side: THREE.DoubleSide }));
      disc.rotation.x = -Math.PI / 2; disc.userData.hit = true; g.add(disc);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.75), new THREE.MeshBasicMaterial({ map: label(text, 512, 128) }));
      sign.position.set(0, 2.2, 0); g.add(sign);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.2), new THREE.MeshBasicMaterial({ color })); pole.position.y = 1.1; g.add(pole);
      scene.add(g); return m;
    };
    const joinHit = ring(-4, 0x22c55e, ['Join a match', 'see open rooms']);
    const openHit = ring(4, 0xf59e0b, ['Open a new room', 'you take the first seat']);
    joinHit.userData.act = 'join'; openHit.userData.act = 'open';

    const wall = new THREE.Group(); scene.add(wall);
    const seats = new THREE.Group(); seats.position.set(0, 0, -2); scene.add(seats);
    const clear = (g: THREE.Group) => { while (g.children.length) { const c = g.children[0] as THREE.Mesh; g.remove(c); c.geometry?.dispose(); const m = c.material as THREE.Material | undefined; (m as THREE.MeshBasicMaterial | undefined)?.map?.dispose(); m?.dispose(); } };

    const rebuild = () => {
      const { matches, size, me, now, selected } = live.current;
      clear(wall);
      matches.slice(0, 10).forEach((m, i) => {
        const col = i % 5, row = Math.floor(i / 5);
        const left = m.phase === 'filling' ? m.lobbyEndsAt - now : m.phase === 'confirming' ? m.confirmEndsAt - now : m.phase === 'trading' ? m.endsAt - now : 0;
        const t = left > 0 ? `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}` : m.phase;
        const p = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.1), new THREE.MeshBasicMaterial({ map: label([m.id, `${m.players.length}/${size} seated`, `${m.phase} ${left > 0 ? t : ''}`], 440, 220, m.phase === 'filling' ? '#14532d' : '#1f2937') }));
        p.position.set((col - 2) * 2.4, 6.2 - row * 1.3, -7); wall.add(p);
      });
      if (!matches.length) {
        const p = new THREE.Mesh(new THREE.PlaneGeometry(6, 1), new THREE.MeshBasicMaterial({ map: label(['No matches yet', 'open the first room'], 600, 160) }));
        p.position.set(0, 5.5, -7); wall.add(p);
      }
      clear(seats);
      if (selected) {
        const n = Math.max(size, selected.players.length);
        const rim = new THREE.Mesh(new THREE.RingGeometry(1.9, 2.0, 48), new THREE.MeshBasicMaterial({ color: 0x94a3b8, side: THREE.DoubleSide }));
        rim.rotation.x = -Math.PI / 2; rim.position.y = 0.03; seats.add(rim);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          const pl = selected.players[i];
          const isMe = !!pl && !!me && pl.address.toLowerCase() === me.toLowerCase();
          const peg = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, pl ? 0.9 : 0.06, 16), new THREE.MeshStandardMaterial({ color: pl ? TEAM_COLOR[pl.team] : 0x475569, emissive: isMe ? 0xffffff : 0x000000, emissiveIntensity: isMe ? 0.35 : 0 }));
          peg.position.set(Math.cos(a) * 1.95, pl ? 0.45 : 0.03, Math.sin(a) * 1.95); seats.add(peg);
        }
      }
    };
    sync.current = rebuild; rebuild();

    const ray = new THREE.Raycaster();
    const onClick = (e: MouseEvent) => {
      const b = r.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1), cam);
      const hit = ray.intersectObjects([joinHit.parent!, openHit.parent!], true).find((h) => h.object.userData.hit);
      const act = hit && (hit.object.userData.act ?? (hit.object.parent === joinHit.parent ? 'join' : 'open'));
      if (act === 'join') live.current.onJoinRing(); else if (act === 'open') live.current.onOpenRing();
    };
    r.domElement.addEventListener('click', onClick);

    const resize = () => { const w = el.clientWidth, h = Math.max(240, el.clientHeight); r.setSize(w, h); cam.aspect = w / h; cam.updateProjectionMatrix(); };
    resize(); window.addEventListener('resize', resize);
    let raf = 0;
    const loop = () => { raf = requestAnimationFrame(loop); r.render(scene, cam); };
    loop();
    return () => {
      cancelAnimationFrame(raf); window.removeEventListener('resize', resize); r.domElement.removeEventListener('click', onClick);
      clear(wall); clear(seats); r.dispose(); el.removeChild(r.domElement);
    };
  }, []);

  // Rebuild the wall and seat ring when the data or the second changes.
  useEffect(() => { sync.current(); }, [props.matches, props.selected, props.size, props.me, Math.floor(props.now / 5)]);

  return <div ref={host} className="w-full h-[420px] rounded border overflow-hidden cursor-pointer" />;
};
