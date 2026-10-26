'use client';

import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GameMatch, MarketQueueData, PositionSide } from '@/lib/types';
import { matchPull } from '@/lib/matches';
import { MATCH_SIZE } from '@/lib/gameTag';
import { animateWalk, Character, disposeObject, Form, makeCharacter, pullPose } from '@/lib/world/characters';
import { clock, makePanel, money, Panel } from '@/lib/world/panel';

export type WorldRoom = { kind: 'hub' } | { kind: 'market'; ticker: string } | { kind: 'arena'; ticker: string };

export interface ResumeSeat {
  ticker: string;
  number: number;
}

interface Props {
  room: WorldRoom;
  markets: MarketQueueData[];
  side: PositionSide | null;
  match: GameMatch | null;
  resume: ResumeSeat | null;
  frozen: boolean;
  onEnterMarket: (ticker: string) => void;
  onPickSide: (side: PositionSide) => void;
  onBackToLobby: () => void;
  onResume: () => void;
  onFail: (message: string) => void;
}

interface Trigger {
  id: string;
  test: (x: number, z: number) => boolean;
  dwell: number;
  fire: () => void;
  progress?: (f: number) => void;
  fades: boolean;
}

const SPEED = 4.2;
const FOOT = 0.42;

const stdMat = (color: number, rough = 0.8) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.05 });

/**
 * The walkable game: a hub with one door per market, a market room (chart wall, side counter)
 * and the tug of war room. Everything it shows comes from the same live data as the classic screens.
 */
export const World3D: React.FC<Props> = (props) => {
  const mount = useRef<HTMLDivElement>(null);
  const fade = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const stickBase = useRef<HTMLDivElement>(null);
  const stickKnob = useRef<HTMLDivElement>(null);
  const live = useRef(props);
  live.current = props;
  const api = useRef<{ setRoom: (r: WorldRoom, from: WorldRoom | null) => void } | null>(null);
  const roomKey = props.room.kind === 'hub' ? `hub:${props.markets.length}:${props.resume ? `${props.resume.ticker}#${props.resume.number}` : '-'}` : `${props.room.kind}:${props.room.ticker}`;
  const prevRoom = useRef<WorldRoom | null>(null);
  const prevKey = useRef<string>('');

  // One renderer for the whole visit.
  useEffect(() => {
    const el = mount.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    } catch (e) {
      live.current.onFail(e instanceof Error ? e.message : 'WebGL is not available on this device.');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    renderer.domElement.style.touchAction = 'none';

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x070b14);
    scene.fog = new THREE.Fog(0x070b14, 26, 60);
    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 120);
    scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x1a1f2e, 1.05));
    const sun = new THREE.DirectionalLight(0xffffff, 1.1);
    sun.position.set(6, 12, 8);
    scene.add(sun);

    const worldRoot = new THREE.Group();
    scene.add(worldRoot);

    // The player's figure persists across rooms.
    let avatar: Character = makeCharacter('human');
    const avatarRoot = new THREE.Group();
    avatarRoot.add(avatar.group);
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.5, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    avatarRoot.add(shadow);
    scene.add(avatarRoot);
    let popT = 1;

    const pos = new THREE.Vector2(0, 5);
    let facing = Math.PI;
    let moving = 0;

    // Per-room state, rebuilt on every room change.
    let triggers: Trigger[] = [];
    let obstacles: { x0: number; x1: number; z0: number; z1: number }[] = [];
    let bounds = { x0: -8, x1: 8, z0: -6, z1: 6 };
    let ticks: (() => void)[] = [];
    let frames: ((t: number, dt: number) => void)[] = [];
    let panels: Panel[] = [];
    const dwellState = new Map<string, number>();
    const locked = new Set<string>();
    let transitioning = false;

    const clearRoom = () => {
      while (worldRoot.children.length) {
        const c = worldRoot.children[0];
        worldRoot.remove(c);
        disposeObject(c);
      }
      triggers = [];
      obstacles = [];
      ticks = [];
      frames = [];
      panels = [];
      dwellState.clear();
      locked.clear();
    };

    const add = (o: THREE.Object3D) => {
      worldRoot.add(o);
      return o;
    };
    const slab = (w: number, h: number, d: number, color: number, x: number, y: number, z: number, rough = 0.8) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), stdMat(color, rough));
      m.position.set(x, y, z);
      add(m);
      return m;
    };
    const sign = (w: number, h: number, px: number, draw: (c: CanvasRenderingContext2D, cw: number, ch: number) => void, x: number, y: number, z: number, transparent = false) => {
      const p = makePanel(w, h, px, draw, transparent);
      p.mesh.position.set(x, y, z);
      add(p.mesh);
      panels.push(p);
      return p;
    };
    const roomShell = (w: number, d: number, wallColor: number, floorColor: number) => {
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), stdMat(floorColor, 0.9));
      floor.rotation.x = -Math.PI / 2;
      add(floor);
      const grid = new THREE.GridHelper(Math.max(w, d), Math.max(w, d), 0x1f2a44, 0x141c30);
      grid.position.y = 0.01;
      add(grid);
      // Walls face into the room only, so the camera outside sees straight through them.
      const wallMat = new THREE.MeshStandardMaterial({ color: wallColor, roughness: 0.9, side: THREE.FrontSide });
      const north = new THREE.Mesh(new THREE.PlaneGeometry(w, 6), wallMat);
      north.position.set(0, 3, -d / 2);
      add(north);
      const west = new THREE.Mesh(new THREE.PlaneGeometry(d, 6), wallMat);
      west.rotation.y = Math.PI / 2;
      west.position.set(-w / 2, 3, 0);
      add(west);
      const east = new THREE.Mesh(new THREE.PlaneGeometry(d, 6), wallMat);
      east.rotation.y = -Math.PI / 2;
      east.position.set(w / 2, 3, 0);
      add(east);
      slab(w, 0.25, 0.3, 0x2a3552, 0, 0.12, -d / 2 + 0.15);
      bounds = { x0: -w / 2 + 0.7, x1: w / 2 - 0.7, z0: -d / 2 + 0.7, z1: d / 2 - 0.7 };
    };
    const exitPortal = (x: number, z: number, label: string, onFire: () => void) => {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 1.05, 32), new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(x, 0.03, z);
      add(ring);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.7, 32), new THREE.MeshBasicMaterial({ color: 0x0ea5e9, transparent: true, opacity: 0.25 }));
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(x, 0.025, z);
      add(disc);
      const label3 = sign(2.6, 0.6, 512, (c, w, h) => {
        c.fillStyle = 'rgba(8,15,30,0.85)';
        c.fillRect(0, 0, w, h);
        c.fillStyle = '#7dd3fc';
        c.font = 'bold 40px system-ui, sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(label, w / 2, h / 2);
      }, x, 1.9, z, true);
      frames.push((t) => {
        ring.scale.setScalar(1 + Math.sin(t * 3) * 0.06);
        label3.mesh.lookAt(camera.position);
      });
      triggers.push({ id: `exit-${label}`, test: (px, pz) => Math.hypot(px - x, pz - z) < 0.95, dwell: 0.5, fire: onFire, fades: true });
    };

    // ---------- HUB ----------
    const buildHub = (fromTicker: string | null) => {
      const L = live.current;
      const items: { key: string; title: string; sub: () => string; color: number; fire: () => void }[] = L.markets.map((m) => ({
        key: m.ticker,
        title: m.ticker,
        sub: () => {
          const cur = live.current.markets.find((x) => x.ticker === m.ticker) ?? m;
          return `${money(cur.price)}  ${cur.priceChange24h >= 0 ? '+' : ''}${cur.priceChange24h.toFixed(2)}%`;
        },
        color: 0x38bdf8,
        fire: () => live.current.onEnterMarket(m.ticker),
      }));
      if (L.resume) {
        const r = L.resume;
        items.push({ key: 'resume', title: 'MY MATCH', sub: () => `${r.ticker} #${r.number}`, color: 0xfbbf24, fire: () => live.current.onResume() });
      }
      const spacing = 3.2;
      const w = Math.max(18, items.length * spacing + 4);
      const d = 15;
      roomShell(w, d, 0x141b2d, 0x0d1424);
      sign(7, 0.9, 1024, (c, cw, ch) => {
        c.fillStyle = '#e2e8f0';
        c.font = 'bold 64px system-ui, sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText('TUG OF WAR HALL', cw / 2, ch / 2);
      }, 0, 5.2, -d / 2 + 0.05, true);
      sign(9, 0.5, 1024, (c, cw, ch) => {
        c.fillStyle = '#64748b';
        c.font = '32px system-ui, sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText('Walk through a door to enter that market', cw / 2, ch / 2);
      }, 0, 4.5, -d / 2 + 0.05, true);

      let spawnX = 0;
      items.forEach((it, i) => {
        const x = -((items.length - 1) * spacing) / 2 + i * spacing;
        if (it.key === fromTicker) spawnX = x;
        // frame
        slab(0.25, 3.4, 0.35, 0x334155, x - 1.1, 1.7, -d / 2 + 0.2);
        slab(0.25, 3.4, 0.35, 0x334155, x + 1.1, 1.7, -d / 2 + 0.2);
        slab(2.45, 0.25, 0.35, 0x334155, x, 3.45, -d / 2 + 0.2);
        const doorMat = new THREE.MeshStandardMaterial({ color: it.color, emissive: it.color, emissiveIntensity: 0.25, roughness: 0.4, transparent: true, opacity: 0.55 });
        const door = new THREE.Mesh(new THREE.BoxGeometry(1.95, 3.2, 0.1), doorMat);
        door.position.set(x, 1.6, -d / 2 + 0.12);
        add(door);
        const p = sign(2.3, 0.95, 512, (c, cw, ch) => {
          c.fillStyle = 'rgba(8,15,30,0.9)';
          c.fillRect(0, 0, cw, ch);
          c.fillStyle = it.key === 'resume' ? '#fbbf24' : '#f8fafc';
          c.font = 'bold 74px system-ui, sans-serif';
          c.textAlign = 'center';
          c.textBaseline = 'middle';
          c.fillText(it.title, cw / 2, ch * 0.36);
          c.fillStyle = '#94a3b8';
          c.font = '38px system-ui, sans-serif';
          c.fillText(it.sub(), cw / 2, ch * 0.78);
        }, x, 4.0, -d / 2 + 0.3);
        ticks.push(() => p.redraw());
        frames.push((t) => {
          doorMat.emissiveIntensity = 0.25 + Math.sin(t * 2 + i) * 0.08;
        });
        const doorX = x;
        triggers.push({
          id: `door-${it.key}`,
          test: (px, pz) => Math.abs(px - doorX) < 1.0 && pz < -d / 2 + 1.5,
          dwell: 0.12,
          fire: it.fire,
          fades: true,
        });
      });
      if (items.length === 0) {
        sign(8, 0.7, 1024, (c, cw, ch) => {
          c.fillStyle = '#f87171';
          c.font = '40px system-ui, sans-serif';
          c.textAlign = 'center';
          c.textBaseline = 'middle';
          c.fillText('No live markets loaded yet', cw / 2, ch / 2);
        }, 0, 2.5, -d / 2 + 0.1, true);
      }
      pos.set(spawnX, d / 2 - 2.5);
      facing = Math.PI;
    };

    // ---------- MARKET ROOM ----------
    const buildMarket = (ticker: string) => {
      const w = 18;
      const d = 14;
      roomShell(w, d, 0x151c2f, 0x0e1526);
      const getM = () => live.current.markets.find((m) => m.ticker === ticker) ?? null;

      // chart wall
      slab(10.4, 4.9, 0.2, 0x1e293b, 0, 3.3, -d / 2 + 0.12);
      const chart = sign(10, 4.5, 1536, (c, cw, ch) => {
        const m = getM();
        c.fillStyle = '#0a1020';
        c.fillRect(0, 0, cw, ch);
        c.textBaseline = 'alphabetic';
        if (!m || m.candles.length < 2) {
          c.fillStyle = '#94a3b8';
          c.font = '48px system-ui, sans-serif';
          c.textAlign = 'center';
          c.fillText('No candle data from the indexer yet', cw / 2, ch / 2);
          return;
        }
        const stride = Math.max(1, Math.floor(m.candles.length / 320));
        const pts = m.candles.filter((_, i) => i % stride === 0 || i === m.candles.length - 1).map((k) => k.close);
        const lo = Math.min(...pts);
        const hi = Math.max(...pts);
        const padX = 90;
        const top = 210;
        const bottom = ch - 70;
        c.strokeStyle = '#1e293b';
        c.lineWidth = 2;
        for (let g = 0; g <= 4; g++) {
          const y = top + ((bottom - top) * g) / 4;
          c.beginPath();
          c.moveTo(padX, y);
          c.lineTo(cw - padX, y);
          c.stroke();
          c.fillStyle = '#64748b';
          c.font = '30px system-ui, sans-serif';
          c.textAlign = 'left';
          c.fillText(money(hi - ((hi - lo) * g) / 4), padX + 8, y - 8);
        }
        const up = pts[pts.length - 1] >= pts[0];
        const col = up ? '#34d399' : '#fb7185';
        c.strokeStyle = col;
        c.lineWidth = 5;
        c.lineJoin = 'round';
        c.beginPath();
        pts.forEach((v, i) => {
          const x = padX + ((cw - padX * 2) * i) / (pts.length - 1);
          const y = bottom - ((v - lo) / (hi - lo || 1)) * (bottom - top);
          if (i === 0) c.moveTo(x, y);
          else c.lineTo(x, y);
        });
        c.stroke();
        c.fillStyle = '#f8fafc';
        c.font = 'bold 84px system-ui, sans-serif';
        c.textAlign = 'left';
        c.fillText(`${m.ticker}-PERP`, padX, 105);
        c.fillStyle = col;
        c.fillText(money(m.price), padX + 560, 105);
        c.font = '40px system-ui, sans-serif';
        c.fillStyle = '#94a3b8';
        c.fillText(`${m.priceChange24h >= 0 ? '+' : ''}${m.priceChange24h.toFixed(2)}% over the last 24h of candles   |   24h high ${money(m.high24h)}   low ${money(m.low24h)}`, padX, 165);
      }, 0, 3.3, -d / 2 + 0.25);
      let lastSig = '';
      ticks.push(() => {
        const m = getM();
        const sig = m ? `${m.price}|${m.candles.length}|${m.candles[m.candles.length - 1]?.close}` : 'none';
        if (sig !== lastSig) {
          lastSig = sig;
          chart.redraw();
        }
      });

      // counter
      const deskZ = -2.6;
      slab(9.4, 1.05, 1.3, 0x334155, 0, 0.52, deskZ, 0.5);
      slab(9.6, 0.12, 1.5, 0x64748b, 0, 1.08, deskZ, 0.4);
      obstacles.push({ x0: -4.8, x1: 4.8, z0: deskZ - 0.8, z1: deskZ + 0.8 });
      sign(5.6, 0.7, 1024, (c, cw, ch) => {
        c.fillStyle = '#f8fafc';
        c.font = 'bold 56px system-ui, sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText('PICK YOUR SIDE', cw / 2, ch / 2);
      }, 0, 2.0, deskZ - 0.1, true);
      sign(4.6, 0.5, 1024, (c, cw, ch) => {
        c.fillStyle = '#94a3b8';
        c.font = '34px system-ui, sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText('Stand on a pad. You turn into that animal.', cw / 2, ch / 2);
      }, 0, 1.5, deskZ - 0.1, true);

      const pad = (px: number, side: PositionSide, color: number, css: string, title: string, sub: string) => {
        const base = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 0.12, 40), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.4 }));
        base.position.set(px, 0.07, 0.9);
        add(base);
        const fill = new THREE.Mesh(new THREE.CircleGeometry(1.15, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 }));
        fill.rotation.x = -Math.PI / 2;
        fill.position.set(px, 0.15, 0.9);
        fill.scale.setScalar(0.001);
        add(fill);
        const lab = sign(2.6, 0.9, 512, (c, cw, ch) => {
          c.fillStyle = 'rgba(8,15,30,0.88)';
          c.fillRect(0, 0, cw, ch);
          c.fillStyle = css;
          c.font = 'bold 66px system-ui, sans-serif';
          c.textAlign = 'center';
          c.textBaseline = 'middle';
          c.fillText(title, cw / 2, ch * 0.4);
          c.fillStyle = '#cbd5e1';
          c.font = '34px system-ui, sans-serif';
          c.fillText(sub, cw / 2, ch * 0.8);
        }, px, 2.7, 0.9, true);
        frames.push(() => lab.mesh.lookAt(camera.position));
        triggers.push({
          id: `pad-${side}`,
          test: (x, z) => Math.hypot(x - px, z - 0.9) < 1.05,
          dwell: 0.7,
          fire: () => live.current.onPickSide(side),
          progress: (f) => fill.scale.setScalar(Math.max(0.001, f)),
          fades: false,
        });
      };
      pad(-3.6, 'bulls', 0x10b981, '#34d399', 'BULLS', 'Long: price goes up');
      pad(3.6, 'bears', 0xf43f5e, '#fb7185', 'BEARS', 'Short: price goes down');

      exitPortal(-w / 2 + 2, d / 2 - 2, 'Back to the hall', () => live.current.onBackToLobby());
      pos.set(0, d / 2 - 3);
      facing = Math.PI;
    };

    // ---------- ARENA ----------
    const buildArena = (ticker: string) => {
      const perSide = Math.max(1, MATCH_SIZE - 1);
      const cols = Math.ceil(perSide / 2);
      const w = Math.max(24, 2 * (4.5 + cols * 1.0 + 2.5));
      const d = 16;
      roomShell(w, d, 0x161d30, 0x0f1628);

      // team zones
      const zone = (sx: number, color: number) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w / 2 - 3.2, 6), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.08 }));
        m.rotation.x = -Math.PI / 2;
        m.position.set(sx * (w / 4 + 1.6), 0.02, 0);
        add(m);
      };
      zone(-1, 0x10b981);
      zone(1, 0xf43f5e);
      // win lines
      for (const x of [-3.2, 0, 3.2]) {
        const line = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 5), new THREE.MeshBasicMaterial({ color: x === 0 ? 0xffffff : 0x94a3b8, transparent: true, opacity: x === 0 ? 0.6 : 0.35 }));
        line.rotation.x = -Math.PI / 2;
        line.position.set(x, 0.03, 0);
        add(line);
      }

      // the board on the north wall
      const board = sign(12, 3.4, 1536, (c, cw, ch) => {
        const m = live.current.match;
        c.fillStyle = '#0a1020';
        c.fillRect(0, 0, cw, ch);
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        if (!m) {
          c.fillStyle = '#94a3b8';
          c.font = '56px system-ui, sans-serif';
          c.fillText('Reading your match from the chain…', cw / 2, ch / 2);
          return;
        }
        const now = Math.floor(Date.now() / 1000);
        c.fillStyle = '#f8fafc';
        c.font = 'bold 110px system-ui, sans-serif';
        c.fillText(m.id, cw / 2, 120);
        let line = '';
        let sub = '';
        let col = '#fbbf24';
        if (m.status === 'filling') {
          line = `Analysis time · ${clock((m.lobbyEndsAt ?? now) - now)}`;
          sub = `${m.total} of ${MATCH_SIZE} seats taken. Study the chart, no money moves yet.`;
        } else if (m.status === 'confirming') {
          line = `Continue with fewer players? ${clock((m.confirmEndsAt ?? now) - now)}`;
          sub = 'Press Continue in the panel. Unconfirmed players are dropped.';
        } else if (m.status === 'opening') {
          line = `Opening trades · ${clock((m.tradeEndsAt ?? now) - now)}`;
          sub = 'Everyone stakes and places their order at the same time.';
        } else if (m.status === 'running' || m.status === 'full') {
          const pull = matchPull(m);
          line = `Price clock · ${clock((m.endsAt ?? now) - now)} left`;
          sub = `start ${m.startPrice ? money(m.startPrice) : '…'} → now ${m.livePrice ? money(m.livePrice) : '…'}${pull ? `  (${pull.label})` : ''}`;
          col = '#34d399';
        } else if (m.status === 'settled') {
          line = m.settledResult === 'tie' ? 'Tie · everyone is refunded' : `${m.settledResult === 'bulls' ? 'BULLS' : 'BEARS'} WIN`;
          sub = m.startPrice && m.endPrice ? `start ${money(m.startPrice)} → end ${money(m.endPrice)}` : '';
          col = m.settledResult === 'bears' ? '#fb7185' : '#34d399';
        } else {
          line = 'Match cancelled';
          sub = 'Not enough players on both sides. No stake was taken.';
          col = '#fb7185';
        }
        c.fillStyle = col;
        c.font = 'bold 84px system-ui, sans-serif';
        c.fillText(line, cw / 2, 270);
        c.fillStyle = '#94a3b8';
        c.font = '46px system-ui, sans-serif';
        c.fillText(sub, cw / 2, 360);
        c.font = 'bold 70px system-ui, sans-serif';
        c.fillStyle = '#34d399';
        c.fillText(`BULLS ${m.bulls}`, cw * 0.22, ch - 100);
        c.fillStyle = '#fb7185';
        c.fillText(`BEARS ${m.bears}`, cw * 0.78, ch - 100);
      }, 0, 3.3, -d / 2 + 0.1);
      ticks.push(() => board.redraw());

      // rope + the teams hang off one group so they move together
      const team = new THREE.Group();
      add(team);
      const ropeLen = w - 5;
      const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, ropeLen, 12), stdMat(0xc9a66b, 0.9));
      rope.rotation.z = Math.PI / 2;
      rope.position.y = 1.15;
      team.add(rope);
      const flag = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.5, 0.06), stdMat(0xef4444, 0.5));
      flag.position.set(0, 0.75, 0);
      team.add(flag);

      // seats: one slot per roster entry on each side, in join order
      const m0 = live.current.match;
      const mkPullers = (side: PositionSide) => {
        const sx = side === 'bulls' ? -1 : 1;
        const form: Form = side === 'bulls' ? 'bull' : 'bear';
        const list: { c: Character; ring: THREE.Mesh; phase: number; baseX: number }[] = [];
        for (let i = 0; i < perSide; i++) {
          const col = Math.floor(i / 2);
          const row = i % 2;
          const x = sx * (2.0 + col * 1.0 + row * 0.45);
          const z = row === 0 ? -0.55 : 0.55;
          const c = makeCharacter(form);
          c.group.position.set(x, 0, z);
          c.group.rotation.y = sx < 0 ? Math.PI / 2 : -Math.PI / 2;
          c.group.visible = false;
          team.add(c.group);
          const ring = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.4, 24), new THREE.MeshBasicMaterial({ color: side === 'bulls' ? 0x10b981 : 0xf43f5e, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
          ring.rotation.x = -Math.PI / 2;
          ring.position.set(x, 0.03, z);
          team.add(ring);
          list.push({ c, ring, phase: i * 0.7, baseX: x });
        }
        return list;
      };
      const bulls = mkPullers('bulls');
      const bears = mkPullers('bears');
      const teamLabel = (x: number, text: string, css: string) => {
        const p = sign(3, 0.8, 512, (c, cw, ch) => {
          c.fillStyle = css;
          c.font = 'bold 80px system-ui, sans-serif';
          c.textAlign = 'center';
          c.textBaseline = 'middle';
          c.fillText(text, cw / 2, ch / 2);
        }, x, 2.9, -2.6, true);
        frames.push(() => p.mesh.lookAt(camera.position));
      };
      teamLabel(-(w / 4 + 1), 'BULLS', '#34d399');
      teamLabel(w / 4 + 1, 'BEARS', '#fb7185');

      let ropeOffset = 0;
      frames.push((t, dt) => {
        const m = live.current.match;
        const pull = m ? matchPull(m) : null;
        const bias = pull ? pull.bias : 0; // +1 bulls, -1 bears
        const target = -bias * 3.0;
        ropeOffset += (target - ropeOffset) * Math.min(1, dt * 1.6);
        team.position.x = ropeOffset;
        const intensity = m && (m.status === 'running' || m.status === 'full') ? 0.4 + Math.abs(bias) * 0.6 : m && m.status === 'opening' ? 0.25 : 0.12;
        // who is seated, in join order; my own seat is shown as a ring, I walk around as myself
        const place = (side: PositionSide, list: typeof bulls) => {
          const roster = (m?.playersList ?? []).filter((p) => p.side === side);
          const count = roster.length || (m ? (side === 'bulls' ? m.bulls : m.bears) : 0);
          list.forEach((s, i) => {
            const mine = roster[i]?.isUser === true;
            const filled = i < count && !mine;
            s.c.group.visible = filled;
            s.ring.visible = true;
            const mat = s.ring.material as THREE.MeshBasicMaterial;
            mat.opacity = mine ? 0.95 : i < count ? 0.15 : 0.35;
            mat.color.setHex(mine ? 0xfbbf24 : side === 'bulls' ? 0x10b981 : 0xf43f5e);
            if (filled) pullPose(s.c, t, intensity, s.phase);
          });
        };
        place('bulls', bulls);
        place('bears', bears);
        flag.position.y = 0.75 + Math.sin(t * 2) * 0.02;
      });

      exitPortal(-w / 2 + 2, d / 2 - 2, 'Leave to the hall', () => live.current.onBackToLobby());
      // spawn beside my own seat when I have one
      const mine = m0?.playersList?.find((p) => p.isUser);
      pos.set(mine ? (mine.side === 'bulls' ? -4 : 4) : 0, 5);
      facing = Math.PI;
      void ticker;
    };

    const setRoom = (r: WorldRoom, from: WorldRoom | null) => {
      clearRoom();
      if (r.kind === 'hub') buildHub(from && from.kind === 'market' ? from.ticker : null);
      else if (r.kind === 'market') buildMarket(r.ticker);
      else buildArena(r.ticker);
      avatarRoot.position.set(pos.x, 0, pos.y);
      transitioning = false;
      if (fade.current) fade.current.style.opacity = '0';
    };
    api.current = { setRoom };

    // ---------- input ----------
    const keys = new Set<string>();
    const joy = { x: 0, y: 0 };
    const onKey = (down: boolean) => (e: KeyboardEvent) => {
      const tg = e.target as HTMLElement | null;
      if (tg && ['INPUT', 'TEXTAREA', 'SELECT'].includes(tg.tagName)) return;
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
        if (down) keys.add(k);
        else keys.delete(k);
        if (!live.current.frozen) e.preventDefault();
      }
    };
    const kd = onKey(true);
    const ku = onKey(false);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);

    // Touch: the left half of the screen is a movement stick that appears wherever the thumb lands;
    // the right half looks around. Mouse: drag anywhere to look, Q / E to turn.
    const surface = root.current;
    const look = { yaw: 0, pitch: 0.62 };
    const STICK = 56;
    let moveId: number | null = null;
    let lookId: number | null = null;
    let origin = { x: 0, y: 0 };
    let last = { x: 0, y: 0 };
    const showStick = (on: boolean) => {
      if (stickBase.current) stickBase.current.style.opacity = on ? '1' : '0';
    };
    const onDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('[data-world-ui]')) return;
      const r = surface?.getBoundingClientRect();
      if (!r) return;
      const leftHalf = e.clientX - r.left < r.width / 2;
      if (e.pointerType === 'touch' && leftHalf && moveId === null) {
        moveId = e.pointerId;
        origin = { x: e.clientX, y: e.clientY };
        if (stickBase.current) {
          stickBase.current.style.left = `${e.clientX - r.left - STICK}px`;
          stickBase.current.style.top = `${e.clientY - r.top - STICK}px`;
        }
        if (stickKnob.current) stickKnob.current.style.transform = 'translate(0,0)';
        showStick(true);
        surface?.setPointerCapture(e.pointerId);
      } else if (lookId === null) {
        lookId = e.pointerId;
        last = { x: e.clientX, y: e.clientY };
        surface?.setPointerCapture(e.pointerId);
      }
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerId === moveId) {
        let dx = (e.clientX - origin.x) / STICK;
        let dy = (e.clientY - origin.y) / STICK;
        const len = Math.hypot(dx, dy);
        if (len > 1) {
          dx /= len;
          dy /= len;
        }
        joy.x = Math.abs(dx) < 0.1 ? 0 : dx;
        joy.y = Math.abs(dy) < 0.1 ? 0 : dy;
        if (stickKnob.current) stickKnob.current.style.transform = `translate(${dx * STICK * 0.7}px, ${dy * STICK * 0.7}px)`;
      } else if (e.pointerId === lookId) {
        look.yaw -= (e.clientX - last.x) * 0.0075;
        look.pitch = Math.max(0.25, Math.min(1.25, look.pitch + (e.clientY - last.y) * 0.005));
        last = { x: e.clientX, y: e.clientY };
      }
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerId === moveId) {
        moveId = null;
        joy.x = 0;
        joy.y = 0;
        showStick(false);
      } else if (e.pointerId === lookId) {
        lookId = null;
      }
    };
    surface?.addEventListener('pointerdown', onDown);
    surface?.addEventListener('pointermove', onMove);
    surface?.addEventListener('pointerup', onUp);
    surface?.addEventListener('pointercancel', onUp);

    // ---------- loop ----------
    const resize = () => {
      const w = el.clientWidth || 800;
      const h = el.clientHeight || 500;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    const clockT = new THREE.Clock();
    let raf = 0;
    let acc = 0;
    let tAll = 0;
    const camPos = new THREE.Vector3(0, 9, 14);
    const camLook = new THREE.Vector3();

    const swapForm = (form: Form) => {
      avatarRoot.remove(avatar.group);
      disposeObject(avatar.group);
      avatar = makeCharacter(form);
      avatarRoot.add(avatar.group);
      popT = 0;
    };

    const loop = () => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, clockT.getDelta());
      tAll += dt;
      acc += dt;
      const L = live.current;

      // which animal am I?
      const mine = L.match?.playersList?.find((p) => p.isUser);
      const wantSide: PositionSide | null = L.room.kind === 'arena' && mine ? mine.side : L.side;
      const wantForm: Form = wantSide === 'bulls' ? 'bull' : wantSide === 'bears' ? 'bear' : 'human';
      if (wantForm !== avatar.form) swapForm(wantForm);
      if (popT < 1) {
        popT = Math.min(1, popT + dt * 3.2);
        const s = popT < 0.6 ? 0.4 + (popT / 0.6) * 0.85 : 1.25 - ((popT - 0.6) / 0.4) * 0.25;
        avatar.group.scale.setScalar(s);
      }

      // move
      let ix = 0;
      let iz = 0;
      if (!L.frozen && !transitioning) {
        if (keys.has('a') || keys.has('arrowleft')) ix -= 1;
        if (keys.has('d') || keys.has('arrowright')) ix += 1;
        if (keys.has('w') || keys.has('arrowup')) iz -= 1;
        if (keys.has('s') || keys.has('arrowdown')) iz += 1;
        ix += joy.x;
        iz += joy.y;
        if (keys.has('q')) look.yaw += dt * 1.8;
        if (keys.has('e')) look.yaw -= dt * 1.8;
      }
      // the stick and keys are relative to where the camera looks
      {
        const c = Math.cos(look.yaw);
        const sn = Math.sin(look.yaw);
        const rx = ix * c + iz * sn;
        const rz = -ix * sn + iz * c;
        ix = rx;
        iz = rz;
      }
      const len = Math.hypot(ix, iz);
      if (len > 0.01) {
        const k = Math.min(1, len) / len;
        let nx = pos.x + ix * k * SPEED * dt;
        let nz = pos.y + iz * k * SPEED * dt;
        nx = Math.max(bounds.x0, Math.min(bounds.x1, nx));
        nz = Math.max(bounds.z0, Math.min(bounds.z1, nz));
        for (const o of obstacles) {
          if (nx > o.x0 - FOOT && nx < o.x1 + FOOT && nz > o.z0 - FOOT && nz < o.z1 + FOOT) {
            // push out along the shallower axis
            const dx = Math.min(nx - (o.x0 - FOOT), o.x1 + FOOT - nx);
            const dz = Math.min(nz - (o.z0 - FOOT), o.z1 + FOOT - nz);
            if (dx < dz) nx = nx - (o.x0 - FOOT) < o.x1 + FOOT - nx ? o.x0 - FOOT : o.x1 + FOOT;
            else nz = nz - (o.z0 - FOOT) < o.z1 + FOOT - nz ? o.z0 - FOOT : o.z1 + FOOT;
          }
        }
        pos.set(nx, nz);
        const target = Math.atan2(ix, iz);
        let diff = target - facing;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        facing += diff * Math.min(1, dt * 12);
        moving = Math.min(1, moving + dt * 8);
      } else {
        moving = Math.max(0, moving - dt * 8);
      }
      avatarRoot.position.set(pos.x, 0, pos.y);
      avatar.group.rotation.y = facing;
      animateWalk(avatar, tAll, moving);

      // triggers
      if (!transitioning) {
        for (const tr of triggers) {
          const inside = tr.test(pos.x, pos.y);
          if (!inside) {
            locked.delete(tr.id);
            if (dwellState.get(tr.id)) {
              dwellState.set(tr.id, 0);
              tr.progress?.(0);
            }
            continue;
          }
          if (locked.has(tr.id)) continue;
          const v = (dwellState.get(tr.id) ?? 0) + dt;
          dwellState.set(tr.id, v);
          tr.progress?.(v / tr.dwell);
          if (v >= tr.dwell) {
            dwellState.set(tr.id, 0);
            tr.progress?.(0);
            if (tr.fades) {
              transitioning = true;
              if (fade.current) fade.current.style.opacity = '1';
              setTimeout(() => tr.fire(), 330);
              setTimeout(() => {
                // If the page did not change rooms, do not leave the screen black.
                transitioning = false;
                if (fade.current) fade.current.style.opacity = '0';
              }, 2000);
            } else {
              locked.add(tr.id);
              tr.fire();
            }
            break;
          }
        }
      }

      for (const f of frames) f(tAll, dt);
      if (acc > 0.5) {
        acc = 0;
        for (const tk of ticks) tk();
      }

      // orbit camera around the avatar
      const dist = 11.5;
      const want = new THREE.Vector3(
        pos.x + Math.sin(look.yaw) * Math.cos(look.pitch) * dist,
        Math.sin(look.pitch) * dist,
        pos.y + Math.cos(look.yaw) * Math.cos(look.pitch) * dist,
      );
      camPos.lerp(want, Math.min(1, dt * 7));
      camera.position.copy(camPos);
      camLook.set(pos.x, 1.2, pos.y);
      camera.lookAt(camLook);
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(loop);

    // first room
    setRoom(live.current.room, null);
    prevRoom.current = live.current.room;
    prevKey.current = roomKey;

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      surface?.removeEventListener('pointerdown', onDown);
      surface?.removeEventListener('pointermove', onMove);
      surface?.removeEventListener('pointerup', onUp);
      surface?.removeEventListener('pointercancel', onUp);
      clearRoom();
      disposeObject(avatarRoot);
      renderer.dispose();
      if (renderer.domElement.parentElement === el) el.removeChild(renderer.domElement);
      api.current = null;
    };
  }, []);

  // Rooms change when the page moves to another screen.
  useEffect(() => {
    if (!api.current) return;
    if (prevKey.current === roomKey) return;
    api.current.setRoom(props.room, prevRoom.current);
    prevRoom.current = props.room;
    prevKey.current = roomKey;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomKey]);

  return (
    <div ref={root} className="relative h-full w-full overflow-hidden bg-[#070b14] select-none" style={{ touchAction: 'none' }}>
      <div ref={mount} className="absolute inset-0" />
      <div ref={fade} className="pointer-events-none absolute inset-0 bg-black transition-opacity duration-300" style={{ opacity: 0 }} />
      <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/55 px-3 py-1 text-[11px] text-zinc-300 [@media(pointer:coarse)]:hidden">
        Move: W A S D / arrows · Look: drag or Q / E
      </div>
      <div className="pointer-events-none absolute bottom-3 left-1/2 hidden -translate-x-1/2 rounded-full bg-black/55 px-3 py-1 text-[11px] text-zinc-300 [@media(pointer:coarse)]:block">
        Left thumb: move · Right thumb: look
      </div>
      <div className="absolute inset-0 z-30 hidden flex-col items-center justify-center gap-3 bg-zinc-950/95 px-8 text-center [@media(pointer:coarse)_and_(orientation:portrait)_and_(max-width:700px)]:flex">
        <svg className="h-14 w-14 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="7" y="3" width="10" height="18" rx="2" />
          <path d="M20 8c1.5 1 2.5 2.7 2.5 4.5M4 16c-1.5-1-2.5-2.7-2.5-4.5" />
        </svg>
        <div className="text-base font-bold text-white">Turn your phone sideways</div>
        <p className="text-xs text-zinc-400">The 3D world plays best in landscape. Rotate your device, or switch to the classic screens from the top bar.</p>
      </div>
      <div
        ref={stickBase}
        className="pointer-events-none absolute h-28 w-28 rounded-full border border-white/25 bg-white/10 transition-opacity"
        style={{ opacity: 0 }}
      >
        <div ref={stickKnob} className="absolute left-1/2 top-1/2 -ml-6 -mt-6 h-12 w-12 rounded-full bg-white/40 shadow-lg" />
      </div>
    </div>
  );
};
