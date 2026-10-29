'use client';

import { nowSec } from '@/lib/clock';
import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { GameMatch, MarketQueueData, PositionSide } from '@/lib/types';
import { matchPull } from '@/lib/matches';
import { MATCH_SIZE, NOMINAL_STAKE_USD } from '@/lib/gameTag';
import { aimArm, animateWalk, Character, disposeObject, Form, makeCharacter, pullPose } from '@/lib/world/characters';
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
  onModelStatus?: (s: 'loading' | 'ready') => void; // characters and rope are loading / all in place
  onModelFail?: (what: string) => void; // a 3D model could not be loaded: the arena shows plain stand-ins instead
  onResume: () => void;
  onFail: (message: string) => void;
  // The match wall (east) and entry ticket (west) of the market room
  matches?: GameMatch[];
  selectedMatch?: GameMatch | null;
  ticketOpen?: boolean;
  ticketBusy?: boolean;
  leverage?: number;
  onPickMatch?: (m: GameMatch) => void;
  onOpenNew?: () => void;
  onConfirmSeat?: () => void;
  onCloseTicket?: () => void;
  // Squads mode: no side pads, random teams, and a different arena
  squads?: boolean;
  arena?: SquadArenaView | null;
}

export interface SquadArenaView {
  id: string;
  phase: string; // filling | confirming | finishable | trading | ended | settled | cancelled
  left: number; // seconds left in the current phase
  size: number;
  players: { team: 0 | 1 | 2; confirmed: boolean; isMe: boolean }[];
  bulls: number | null; // live team scores in USDso
  bears: number | null;
  result: number; // 0 pending, 1 Bulls, 2 Bears, 3 refund
  scale: number; // a score gap of this many USDso pulls the rope all the way
  kick: number; // counts my confirmed trades in this match: each new one makes my team heave
  myTeam: 0 | 1 | 2;
}

interface Trigger {
  id: string;
  test: (x: number, z: number) => boolean;
  dwell: number;
  fire: () => void;
  progress?: (f: number) => void;
  fades: boolean;
}

// The rope and the Bull and Bear characters are light models served from /public/models; loaded once, cloned per seat.
const modelCache: Record<string, Promise<THREE.Object3D>> = {};
const loadModel = (name: 'rope' | 'bull' | 'bear'): Promise<THREE.Object3D> => {
  if (!modelCache[name]) {
    modelCache[name] = new GLTFLoader().loadAsync(`/models/${name}.glb`).then((g) => g.scene).catch((e) => {
      delete modelCache[name];
      throw e;
    });
  }
  return modelCache[name];
};

const SPEED = 4.2;
const FOOT = 0.42;

const stdMat = (color: number, rough = 0.8) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.05 });

function drawMarketChart(c: CanvasRenderingContext2D, cw: number, ch: number, m: MarketQueueData | null) {
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
}

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
    // my own seat on the rope: while I have not walked away from it, I stand there and pull
    let seatSpot: { x: number; z: number; face: number } | null = null;
    let unseated = false;
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
      const sq = !!live.current.squads;

      // chart wall
      slab(10.4, 4.9, 0.2, 0x1e293b, 0, 3.3, -d / 2 + 0.12);
      const chart = sign(10, 4.5, 1536, (c, cw, ch) => drawMarketChart(c, cw, ch, getM()), 0, 3.3, -d / 2 + 0.25);
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
        c.fillText(sq ? 'FIND A MATCH' : 'PICK YOUR SIDE', cw / 2, ch / 2);
      }, 0, 2.0, deskZ - 0.1, true);
      sign(4.6, 0.5, 1024, (c, cw, ch) => {
        c.fillStyle = '#94a3b8';
        c.font = '34px system-ui, sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(sq ? 'Right wall: open rooms. Left wall: your ticket. Teams are random.' : 'Stand on a pad. You turn into that animal.', cw / 2, ch / 2);
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
      if (!sq) {
        pad(-3.6, 'bulls', 0x10b981, '#34d399', 'BULLS', 'Long: price goes up');
        pad(3.6, 'bears', 0xf43f5e, '#fb7185', 'BEARS', 'Short: price goes down');
      }


      // ---- Match wall (east wall): one board and one pad per joinable match, plus "open a new match".
      const wallX = w / 2 - 0.3;
      const padX = w / 2 - 2.6;
      const slotZ = (i: number) => -5 + i * 2;
      const joinable = () =>
        [...(live.current.matches ?? [])]
          .filter((m) => m.status === 'filling' || !!m.playersList?.some((p) => p.isUser))
          .sort((a, b) => Number(b.id.split('#')[1]) - Number(a.id.split('#')[1]))
          .slice(0, 5);
      const faceRoom = (mesh: THREE.Mesh, rotY: number) => { mesh.rotation.y = rotY; };
      const head = sign(5.2, 0.8, 1024, (c, cw, ch) => {
        const L = live.current;
        c.fillStyle = 'rgba(8,15,30,0.92)'; c.fillRect(0, 0, cw, ch);
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillStyle = '#f8fafc'; c.font = 'bold 56px system-ui, sans-serif';
        c.fillText(`${ticker} ACTIVE MATCHES`, cw / 2, ch * 0.36);
        c.font = '34px system-ui, sans-serif';
        c.fillStyle = sq || L.side ? (sq || L.side === 'bulls' ? '#34d399' : '#fb7185') : '#fbbf24';
        c.fillText(sq ? 'Step on a pad to join. Your team is drawn when you sit.' : L.side ? `Your pick: ${L.side === 'bulls' ? 'BULLS (LONG)' : 'BEARS (SHORT)'}. Step on a pad to join.` : 'First pick Bulls or Bears on the pads below.', cw / 2, ch * 0.76);
      }, wallX, 3.7, -1);
      faceRoom(head.mesh, -Math.PI / 2);
      const rows: Panel[] = [];
      for (let i = 0; i < 6; i++) {
        const z = slotZ(i);
        const row = sign(3.6, 1.1, 1024, (c, cw, ch) => {
          c.fillStyle = 'rgba(8,15,30,0.92)'; c.fillRect(0, 0, cw, ch);
          c.textAlign = 'left'; c.textBaseline = 'middle';
          if (i === 5) {
            c.fillStyle = '#fbbf24'; c.font = 'bold 56px system-ui, sans-serif'; c.fillText('+ OPEN A NEW MATCH', 32, ch * 0.38);
            c.fillStyle = '#cbd5e1'; c.font = '34px system-ui, sans-serif'; c.fillText('Stand on the pad. You take the first seat.', 32, ch * 0.76);
            return;
          }
          const m = joinable()[i];
          if (!m) { c.fillStyle = '#64748b'; c.font = '44px system-ui, sans-serif'; c.fillText(i === 0 ? `No ${ticker} match is open right now` : 'Empty slot', 32, ch / 2); return; }
          const mine = !!m.playersList?.some((p) => p.isUser);
          const left = m.lobbyEndsAt ? Math.max(0, m.lobbyEndsAt - nowSec()) : 0;
          c.fillStyle = '#f8fafc'; c.font = 'bold 56px system-ui, sans-serif'; c.fillText(m.id, 32, ch * 0.32);
          c.fillStyle = '#34d399'; c.font = 'bold 40px system-ui, sans-serif';
          c.fillText(sq ? `${m.total}/${m.size ?? MATCH_SIZE} seated · random teams` : `${m.total}/${MATCH_SIZE} seated · ${m.bulls} bulls · ${m.bears} bears`, 32, ch * 0.62);
          c.fillStyle = '#94a3b8'; c.font = '32px system-ui, sans-serif';
          c.fillText(mine ? 'You are seated: step here to return' : `Lobby ${clock(left)} left · $${NOMINAL_STAKE_USD} stake`, 32, ch * 0.86);
        }, wallX, 1.7, z);
        faceRoom(row.mesh, -Math.PI / 2);
        rows.push(row);
        const color = i === 5 ? 0xf59e0b : 0x10b981;
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.1, 32), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.4 }));
        base.position.set(padX, 0.06, z); add(base);
        const fill = new THREE.Mesh(new THREE.CircleGeometry(0.72, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 }));
        fill.rotation.x = -Math.PI / 2; fill.position.set(padX, 0.13, z); fill.scale.setScalar(0.001); add(fill);
        triggers.push({
          id: `match-pad-${i}`,
          test: (x, zz) => Math.hypot(x - padX, zz - z) < 0.75,
          dwell: 0.8,
          fire: () => {
            const L = live.current;
            if (!sq && !L.side) return;
            if (i === 5) L.onOpenNew?.();
            else { const m = joinable()[i]; if (m) L.onPickMatch?.(m); }
          },
          progress: (f) => fill.scale.setScalar(Math.max(0.001, f)),
          fades: false,
        });
      }

      // ---- Entry ticket (west wall): fills in once you pick a match; two pads confirm or go back.
      const tX = -w / 2 + 0.3;
      const ticket = sign(5.6, 3.6, 1280, (c, cw, ch) => {
        const L = live.current;
        const m = L.ticketOpen ? L.selectedMatch : null;
        c.fillStyle = 'rgba(8,15,30,0.94)'; c.fillRect(0, 0, cw, ch);
        c.textAlign = 'left'; c.textBaseline = 'middle';
        c.fillStyle = '#34d399'; c.font = 'bold 40px system-ui, sans-serif'; c.fillText('TUG OF WAR ENTRY TICKET', 48, ch * 0.09);
        if (!m || (!sq && !L.side)) {
          c.fillStyle = '#94a3b8'; c.font = '48px system-ui, sans-serif';
          c.fillText('Pick a match on the right wall', 48, ch * 0.45);
          c.font = '36px system-ui, sans-serif'; c.fillText('Your ticket appears here before you sit.', 48, ch * 0.58);
          return;
        }
        const lev = L.leverage ?? 1;
        const line = (y: number, k: string, v: string, vc = '#f8fafc') => {
          c.fillStyle = '#94a3b8'; c.font = '36px system-ui, sans-serif'; c.fillText(k, 48, ch * y);
          c.fillStyle = vc; c.font = 'bold 40px system-ui, sans-serif'; c.textAlign = 'right'; c.fillText(v, cw - 48, ch * y); c.textAlign = 'left';
        };
        c.fillStyle = '#f8fafc'; c.font = 'bold 84px system-ui, sans-serif'; c.fillText(m.id, 48, ch * 0.2);
        if (sq) line(0.33, 'Your team', 'Drawn when you take the seat', '#fbbf24');
        else line(0.33, 'Your team', L.side === 'bulls' ? 'BULLS (LONG)' : 'BEARS (SHORT)', L.side === 'bulls' ? '#34d399' : '#fb7185');
        line(0.43, 'Market', `${ticker} / USD, isolated`);
        line(0.53, 'Stake', `$${NOMINAL_STAKE_USD}.00`);
        if (sq) {
          line(0.63, 'Seats taken', `${m.total} / ${m.size ?? MATCH_SIZE}`);
          line(0.73, 'Trading', 'Any direction, any leverage, any time');
        } else {
          line(0.63, 'Seats taken', `${m.total} / ${MATCH_SIZE}  (${m.bulls} bulls, ${m.bears} bears)`);
          line(0.73, 'Leverage', `${lev}x: $${NOMINAL_STAKE_USD} x ${lev} = $${NOMINAL_STAKE_USD * lev} exposure`);
        }
        c.fillStyle = '#cbd5e1'; c.font = '30px system-ui, sans-serif';
        c.fillText(sq ? 'Stake + your own trading vault. Leave before the lock and both come back.' : 'Confirming takes your seat. Leave before the lock and nothing is lost.', 48, ch * 0.85);
        c.fillText(sq ? 'Better team average vault gain wins; verified on chain.' : 'Keep this tab open: your trade is placed automatically at the lock.', 48, ch * 0.92);
      }, tX, 2.7, 0);
      faceRoom(ticket.mesh, Math.PI / 2);
      const ticketPad = (z: number, color: number, css: string, text: string, act: () => void) => {
        const px = -w / 2 + 2.8;
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.1, 32), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.4 }));
        base.position.set(px, 0.06, z); add(base);
        const fill = new THREE.Mesh(new THREE.CircleGeometry(0.82, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 }));
        fill.rotation.x = -Math.PI / 2; fill.position.set(px, 0.13, z); fill.scale.setScalar(0.001); add(fill);
        const lab = sign(2.2, 0.55, 512, (c, cw, ch) => {
          c.fillStyle = 'rgba(8,15,30,0.9)'; c.fillRect(0, 0, cw, ch);
          c.fillStyle = css; c.font = 'bold 44px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, cw / 2, ch / 2);
        }, px, 1.6, z, true);
        frames.push(() => lab.mesh.lookAt(camera.position));
        triggers.push({
          id: `ticket-${text}`,
          test: (x, zz) => Math.hypot(x - px, zz - z) < 0.85,
          dwell: 0.8,
          fire: () => { const L = live.current; if (L.ticketOpen && !L.ticketBusy) act(); },
          progress: (f) => fill.scale.setScalar(Math.max(0.001, f)),
          fades: false,
        });
      };
      ticketPad(-1.8, 0x10b981, '#34d399', 'TAKE MY SEAT', () => live.current.onConfirmSeat?.());
      ticketPad(1.8, 0x64748b, '#cbd5e1', 'BACK', () => live.current.onCloseTicket?.());

      // Redraw the wall and the ticket when anything they show changes (and once a second for the lobby clocks).
      let wallSig = '';
      ticks.push(() => {
        const L = live.current;
        const sig = JSON.stringify([L.side, L.ticketOpen, L.selectedMatch?.size, L.leverage, L.selectedMatch?.id, L.selectedMatch?.total, Math.floor(nowSec()), joinable().map((m) => [m.id, m.total, m.bulls, m.bears, m.status])]);
        if (sig === wallSig) return;
        wallSig = sig;
        head.redraw(); rows.forEach((r) => r.redraw()); ticket.redraw();
      });

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
      const board = sign(9.6, 3.4, 1536, (c, cw, ch) => {
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
        const now = nowSec();
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
      }, -5.3, 3.3, -d / 2 + 0.1);
      ticks.push(() => board.redraw());

      // the live chart beside it: this is the analysis time, so the market is on the wall
      const getArenaMarket = () => live.current.markets.find((x) => x.ticker === ticker) ?? null;
      slab(10.2, 3.9, 0.2, 0x1e293b, 5.3, 3.3, -d / 2 + 0.05);
      const arenaChart = sign(9.8, 3.5, 1536, (c, cw, ch) => drawMarketChart(c, cw, ch, getArenaMarket()), 5.3, 3.3, -d / 2 + 0.2);
      let arenaSig = '';
      ticks.push(() => {
        const m = getArenaMarket();
        const sig = m ? `${m.price}|${m.candles.length}|${m.candles[m.candles.length - 1]?.close}` : 'none';
        if (sig !== arenaSig) {
          arenaSig = sig;
          arenaChart.redraw();
        }
      });

      // rope + the teams hang off one group so they move together
      const team = new THREE.Group();
      add(team);
      const ropeLen = w - 5;
      // The rope is a chain of points (Verlet): gravity pulls it into a sag, the segments keep their length,
      // and each hand that grips it holds one point. More effort means less slack, so it tightens and straightens.
      const N = 64;
      const seg = ropeLen / (N - 1);
      const rx = new Float32Array(N);
      const ry = new Float32Array(N);
      const ox = new Float32Array(N);
      const oy = new Float32Array(N);
      for (let k = 0; k < N; k++) {
        rx[k] = ox[k] = -ropeLen / 2 + k * seg;
        ry[k] = oy[k] = 1.3;
      }
      const ropeMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 8), stdMat(0xc9a66b, 0.95), N - 1);
      ropeMesh.frustumCulled = false;
      team.add(ropeMesh);
      const dummy = new THREE.Object3D();
      const flag = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.5, 0.06), stdMat(0xef4444, 0.5));
      team.add(flag);

      // seats: one slot per roster entry on each side, in join order
      const m0 = live.current.match;
      const mkPullers = (side: PositionSide) => {
        const sx = side === 'bulls' ? -1 : 1;
        const form: Form = side === 'bulls' ? 'bull' : 'bear';
        const list: { c: Character; ring: THREE.Mesh; phase: number; baseX: number; sx: number }[] = [];
        for (let i = 0; i < perSide; i++) {
          const col = Math.floor(i / 2);
          const row = i % 2;
          const x = sx * (2.0 + col * 1.0 + row * 0.45);
          const z = row === 0 ? -0.45 : 0.45;
          const c = makeCharacter(form);
          c.group.position.set(x, 0, z);
          // facing the other team, turned a little toward the rope so both hands reach it
          c.group.rotation.order = 'YXZ';
          c.group.rotation.y = (sx < 0 ? Math.PI / 2 : -Math.PI / 2) + 0.45 * (row === 0 ? 1 : -1) * (sx > 0 ? 1 : -1);
          c.group.visible = false;
          team.add(c.group);
          const ring = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.4, 24), new THREE.MeshBasicMaterial({ color: side === 'bulls' ? 0x10b981 : 0xf43f5e, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
          ring.rotation.x = -Math.PI / 2;
          ring.position.set(x, 0.03, z);
          team.add(ring);
          list.push({ c, ring, phase: i * 0.7, baseX: x, sx });
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
      let vel = 0;
      const handTo = new THREE.Vector3();
      frames.push((t, dt) => {
        const m = live.current.match;
        const pull = m ? matchPull(m) : null;
        const bias = pull ? pull.bias : 0; // +1 bulls, -1 bears
        const target = -bias * 3.0;
        const prev = ropeOffset;
        ropeOffset += (target - ropeOffset) * Math.min(1, dt * 1.6);
        team.position.x = ropeOffset;
        vel += ((ropeOffset - prev) / Math.max(dt, 1e-3) - vel) * Math.min(1, dt * 6); // smoothed rope speed
        const intensity = m && (m.status === 'running' || m.status === 'full') ? 0.4 + Math.abs(bias) * 0.6 : m && m.status === 'opening' ? 0.25 : 0.12;
        const stepAmt = Math.min(1, Math.abs(vel) * 2.5);

        // who is seated, in join order; my own seat is shown as a ring, I walk around as myself
        const pins = new Map<number, { y: number }>();
        const place = (side: PositionSide, list: typeof bulls) => {
          const roster = (m?.playersList ?? []).filter((p) => p.side === side);
          const count = roster.length || (m ? (side === 'bulls' ? m.bulls : m.bears) : 0);
          list.forEach((s, i) => {
            const mine = roster[i]?.isUser === true;
            if (mine && unseated && Math.hypot(pos.x - (s.baseX + team.position.x), pos.y - s.c.group.position.z) < 0.7) unseated = false; // walked back to the seat
            const filled = i < count && !(mine && unseated);
            if (mine && !unseated) seatSpot = { x: s.baseX + team.position.x, z: s.c.group.position.z, face: s.c.group.rotation.y };
            s.c.group.visible = filled;
            s.ring.visible = true;
            const mat = s.ring.material as THREE.MeshBasicMaterial;
            mat.opacity = mine ? 0.95 : i < count ? 0.15 : 0.35;
            mat.color.setHex(mine ? 0xfbbf24 : side === 'bulls' ? 0x10b981 : 0xf43f5e);
            if (!filled) return;
            const dragged = vel * -s.sx > 0.05;
            pullPose(s.c, t, intensity, s.phase, stepAmt, dragged);
            s.c.group.updateMatrix();
            // the point of the rope this puller grips: a little toward the middle of the rope
            const hx = s.baseX - s.sx * 0.42;
            const idx = Math.max(1, Math.min(N - 2, Math.round((hx + ropeLen / 2) / seg)));
            pins.set(idx, { y: 1.3 + Math.sin(t * 6 + s.phase) * 0.03 * intensity });
          });
        };
        place('bulls', bulls);
        place('bears', bears);

        // rope step: gravity, then keep every segment about its length, hands hold their points
        const slack = 1 + 0.07 * (1 - Math.min(1, intensity));
        const rest = seg * slack;
        const sub = 2;
        const h = Math.min(dt, 1 / 30) / sub;
        for (let s2 = 0; s2 < sub; s2++) {
          for (let k = 0; k < N; k++) {
            const pin = pins.get(k);
            if (pin) {
              ox[k] = rx[k];
              oy[k] = ry[k];
              ry[k] = pin.y;
              continue;
            }
            const vx = (rx[k] - ox[k]) * 0.985;
            const vy = (ry[k] - oy[k]) * 0.985;
            ox[k] = rx[k];
            oy[k] = ry[k];
            rx[k] += vx;
            ry[k] += vy - 9.8 * 0.7 * h * h;
            if (ry[k] < 0.06) ry[k] = 0.06;
          }
          for (let it = 0; it < 10; it++) {
            for (let k = 0; k < N - 1; k++) {
              const dx = rx[k + 1] - rx[k];
              const dy = ry[k + 1] - ry[k];
              const dist = Math.hypot(dx, dy) || 1e-6;
              const diff = (dist - rest) / dist;
              const a = pins.has(k);
              const b = pins.has(k + 1);
              if (a && b) continue;
              const wa = a ? 0 : b ? 1 : 0.5;
              const wb = b ? 0 : a ? 1 : 0.5;
              rx[k] += dx * diff * wa;
              ry[k] += dy * diff * wa;
              rx[k + 1] -= dx * diff * wb;
              ry[k + 1] -= dy * diff * wb;
            }
          }
        }
        for (let k = 0; k < N - 1; k++) {
          const dx = rx[k + 1] - rx[k];
          const dy = ry[k + 1] - ry[k];
          dummy.position.set((rx[k] + rx[k + 1]) / 2, (ry[k] + ry[k + 1]) / 2, 0);
          dummy.rotation.set(0, 0, Math.atan2(dy, dx) - Math.PI / 2);
          dummy.scale.set(1, Math.hypot(dx, dy) * 1.02, 1);
          dummy.updateMatrix();
          ropeMesh.setMatrixAt(k, dummy.matrix);
        }
        ropeMesh.instanceMatrix.needsUpdate = true;
        const mid = N >> 1;
        flag.position.set(rx[mid], ry[mid] - 0.42, 0);

        // now the hands: each arm reaches for the exact point of rope its owner holds
        const reach = (list: typeof bulls) =>
          list.forEach((s) => {
            if (!s.c.group.visible) return;
            const hx = s.baseX - s.sx * 0.42;
            const idx = Math.max(1, Math.min(N - 2, Math.round((hx + ropeLen / 2) / seg)));
            handTo.set(rx[idx], ry[idx], 0);
            aimArm(s.c, s.c.armL, handTo);
            handTo.set(rx[idx] + s.sx * -0.08, ry[idx], 0);
            aimArm(s.c, s.c.armR, handTo);
          });
        reach(bulls);
        reach(bears);
      });

      exitPortal(-w / 2 + 2, d / 2 - 2, 'Leave to the hall', () => live.current.onBackToLobby());
      // spawn beside my own seat when I have one
      const mine = m0?.playersList?.find((p) => p.isUser);
      pos.set(mine ? (mine.side === 'bulls' ? -4 : 4) : 0, 5);
      facing = Math.PI;
      void ticker;
    };


    // ---------- SQUADS ARENA: the real rope (a skinned model), Bulls and Bears characters pulling on it, rope moved by the on-chain scores ----------
    let arenaSerial = 0;
    const buildSquadArena = (ticker: string) => {
      const token = ++arenaSerial;
      const w = 30;
      const d = 16;
      roomShell(w, d, 0x161d30, 0x0f1628);
      const ROPE_SX = 2.2; // the rope model is 8 long: stretched to 17.6 so up to ten columns can reach it
      const ROPE_SY = 1.15;
      const ROPE_DROP = 1.03; // the middle of the rope lies near the floor; the ends rise to the pullers' hands
      const SEG = 0.5 * ROPE_SX; // world length of one rope bone
      const MAXSEATS = 20;

      // floor: the centre line and the two finish marks the rope is pulled toward
      const floorLine = (x: number, color: number, wd: number) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(wd, 5), new THREE.MeshBasicMaterial({ color }));
        m.rotation.x = -Math.PI / 2;
        m.position.set(x, 0.03, 0);
        add(m);
      };
      floorLine(0, 0xf8fafc, 0.1);
      floorLine(-3.4, 0x10b981, 0.07);
      floorLine(3.4, 0xf43f5e, 0.07);
      const teamLabel = (x: number, text: string, css: string) => {
        const p = sign(3.2, 0.9, 512, (c, cw, ch) => {
          c.fillStyle = css;
          c.font = 'bold 84px system-ui, sans-serif';
          c.textAlign = 'center';
          c.textBaseline = 'middle';
          c.fillText(text, cw / 2, ch / 2);
        }, x, 3.4, -3.2, true);
        frames.push(() => p.mesh.lookAt(camera.position));
      };
      teamLabel(-6, 'BULLS', '#34d399');
      teamLabel(6, 'BEARS', '#fb7185');

      // the rope group moves with its pullers, so the red centre mark drifts toward the winning side
      const team = new THREE.Group();
      add(team);
      const ropeGroup = new THREE.Group();
      ropeGroup.scale.set(ROPE_SX, ROPE_SY, ROPE_SY);
      ropeGroup.position.y = -ROPE_DROP;
      team.add(ropeGroup);
      // plain stand-in until the model is loaded (or if it cannot be)
      const plainRope = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, SEG * 16, 8), stdMat(0xc9a66b, 0.95));
      plainRope.rotation.z = Math.PI / 2;
      plainRope.position.y = 0.3;
      team.add(plainRope);
      const plainFlag = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.4, 0.08), stdMat(0xdc2626, 0.5));
      plainFlag.position.y = 0.4;
      team.add(plainFlag);
      let ropeBones: { l: THREE.Object3D[]; r: THREE.Object3D[] } | null = null as { l: THREE.Object3D[]; r: THREE.Object3D[] } | null;
      let sig = '';
      const ready: Record<string, boolean> = { rope: false, bull: false, bear: false };
      const tpl: Record<number, THREE.Object3D | undefined> = {};

      loadModel('rope')
        .then((g) => {
          if (token !== arenaSerial) return;
          const m = cloneSkinned(g);
          m.traverse((o) => { o.frustumCulled = false; });
          ropeGroup.add(m);
          const l: THREE.Object3D[] = [];
          const r: THREE.Object3D[] = [];
          for (let k = 1; k <= 8; k++) {
            const a = m.getObjectByName(`RopeL_0${k}`);
            const b = m.getObjectByName(`RopeR_0${k}`);
            if (a) l.push(a);
            if (b) r.push(b);
          }
          ropeBones = { l, r };
          plainRope.visible = false;
          plainFlag.visible = false;
          ready.rope = true;
          if (ready.bull && ready.bear) live.current.onModelStatus?.('ready');
        })
        .catch(() => { live.current.onModelFail?.('the rope'); live.current.onModelStatus?.('ready'); });
      const loadTeam = (name: 'bull' | 'bear', t: 1 | 2) =>
        loadModel(name)
          .then((g) => {
            if (token !== arenaSerial) return;
            const base = cloneSkinned(g);
            // the blue overalls take the team colour
            base.traverse((o) => {
              const mesh = o as THREE.Mesh;
              if (!mesh.isMesh) return;
              mesh.frustumCulled = false;
              const mat = mesh.material as THREE.MeshStandardMaterial;
              if (mat && mat.name === 'blue') {
                const c = mat.clone();
                c.color.setHex(t === 1 ? 0x059669 : 0xe11d48);
                mesh.material = c;
              }
            });
            tpl[t] = base;
            ready[name] = true;
            if (ready.rope && ready.bull && ready.bear) live.current.onModelStatus?.('ready');
            sig = '';
          })
          .catch(() => { live.current.onModelFail?.(name === 'bull' ? 'the bull' : 'the bear'); live.current.onModelStatus?.('ready'); });
      loadTeam('bull', 1);
      loadTeam('bear', 2);
      live.current.onModelStatus?.('loading');

      // a rig for one cloned character: the bones we move, and the rest direction of each arm bone
      interface Rig {
        spine: THREE.Object3D;
        chest: THREE.Object3D;
        upL: THREE.Object3D; foreL: THREE.Object3D;
        upR: THREE.Object3D; foreR: THREE.Object3D;
        hips: THREE.Object3D; hipsY: number; thigh: number;
        upLegL: THREE.Object3D; legL: THREE.Object3D; upLegR: THREE.Object3D; legR: THREE.Object3D;
        restUpL: THREE.Vector3; restForeL: THREE.Vector3;
        restUpR: THREE.Vector3; restForeR: THREE.Vector3;
      }
      const makeRig = (m: THREE.Object3D): Rig | null => {
        const g = (n: string) => m.getObjectByName(n);
        const spine = g('Spine'), chest = g('Chest');
        const upL = g('LeftArm'), foreL = g('LeftForeArm'), handL = g('LeftHand');
        const upR = g('RightArm'), foreR = g('RightForeArm'), handR = g('RightHand');
        const hips = g('Hips'), upLegL = g('LeftUpLeg'), legL = g('LeftLeg'), upLegR = g('RightUpLeg'), legR = g('RightLeg');
        if (!spine || !chest || !upL || !foreL || !handL || !upR || !foreR || !handR || !hips || !upLegL || !legL || !upLegR || !legR) return null;
        return {
          spine, chest, upL, foreL, upR, foreR,
          hips, hipsY: hips.position.y, thigh: legL.position.length(), upLegL, legL, upLegR, legR,
          restUpL: foreL.position.clone().normalize(), restForeL: handL.position.clone().normalize(),
          restUpR: foreR.position.clone().normalize(), restForeR: handR.position.clone().normalize(),
        };
      };

      interface Puller {
        holder: THREE.Group;
        ring: THREE.Mesh;
        peg: THREE.Group;
        pegMat: THREE.MeshStandardMaterial;
        model: THREE.Object3D | null;
        rig: Rig | null;
        phase: number;
        stool: THREE.Mesh;
        chair: THREE.Group;
        human: Character | null;
        sx: number;
        x: number;
        z: number;
        on: boolean;
      }
      const ringMesh = (inner: number, outer: number) => {
        const r = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 28), new THREE.MeshBasicMaterial({ color: 0x64748b, side: THREE.DoubleSide, transparent: true, opacity: 0.8 }));
        r.rotation.x = -Math.PI / 2;
        r.visible = false;
        return r;
      };
      const makePeg = () => {
        const mat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.5 });
        const g = new THREE.Group();
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.9, 16), mat);
        body.position.y = 0.45;
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 12), mat);
        head.position.y = 1.15;
        g.add(body, head);
        g.visible = false;
        return { g, mat };
      };
      const mkPool = (sx: number): Puller[] =>
        Array.from({ length: MAXSEATS }, (_, i) => {
          const holder = new THREE.Group();
          holder.scale.setScalar(0.85);
          holder.visible = false;
          team.add(holder);
          const { g: peg, mat: pegMat } = makePeg();
          peg.scale.setScalar(1 / 0.85);
          holder.add(peg);
          const ring = ringMesh(0.5, 0.62);
          team.add(ring);
          const stool = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.3, 1, 18), stdMat(0x475569, 0.7));
          stool.visible = false;
          holder.add(stool);
          // a simple chair: the person sits in it while the lobby waits
          const chair = new THREE.Group();
          const wood = stdMat(0x8b6b4a, 0.85);
          const seat = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.07, 0.6), wood);
          seat.position.set(0, 0.5, -0.02);
          const back = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 0.06), wood);
          back.position.set(0, 0.84, -0.32);
          chair.add(seat, back);
          for (const lx of [-0.26, 0.26]) for (const lz of [-0.28, 0.24]) {
            const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.06), wood);
            leg.position.set(lx, 0.25, lz);
            chair.add(leg);
          }
          chair.visible = false;
          holder.add(chair);
          const col = i >> 1;
          return { holder, ring, peg, pegMat, model: null, rig: null, stool, chair, human: null, phase: i * 0.7, sx, x: sx * (1.5 + col * 0.95), z: i % 2 === 0 ? -0.45 : 0.45, on: false };
        });
      const bulls = mkPool(-1);
      const bears = mkPool(1);
      // lobby: before the lock nobody has a team yet, so everyone waits in a neutral line
      const lobby = Array.from({ length: MAXSEATS }, () => {
        const { g, mat } = makePeg();
        const ring = ringMesh(0.45, 0.58);
        add(g);
        add(ring);
        return { g, mat, ring };
      });

      // rope sag: the middle hangs, tension straightens it
      // The rope lies near the floor in the middle and climbs to the pullers' hands within two bones, then runs level.
      // `ropeLift` is how steeply it climbs: a slack rope lies lower, a taut one rises.
      let ropeLift = 0.9;
      const bend = (k: number) => (k === 0 ? ropeLift : k === 2 ? -ropeLift : 0);
      const ropeYAt = (xl: number) => {
        let ang = 0;
        let y = 1;
        let rem = Math.abs(xl) / SEG;
        for (let k = 0; k < 8 && rem > 0; k++) {
          const step = Math.min(1, rem);
          ang += bend(k);
          y += 0.5 * Math.sin(ang) * step;
          rem -= step;
        }
        return Math.max(0.08, y * ROPE_SY - ROPE_DROP);
      };
      const aim = (bone: THREE.Object3D, rest: THREE.Vector3, targetWorld: THREE.Vector3) => {
        const par = bone.parent;
        if (!par) return;
        const local = par.worldToLocal(targetWorld.clone()).sub(bone.position).normalize();
        bone.quaternion.setFromUnitVectors(rest, local);
        bone.updateMatrixWorld(true);
      };

      const board = sign(8, 2.2, 1280, (c, cw, ch) => {
        const A = live.current.arena;
        c.fillStyle = 'rgba(8,15,30,0.94)'; c.fillRect(0, 0, cw, ch);
        c.textAlign = 'center'; c.textBaseline = 'middle';
        if (!A) { c.fillStyle = '#94a3b8'; c.font = '56px system-ui, sans-serif'; c.fillText('Loading the room…', cw / 2, ch / 2); return; }
        const mm = (x: number) => `${Math.floor(Math.max(0, x) / 60)}:${String(Math.floor(Math.max(0, x)) % 60).padStart(2, '0')}`;
        const seated = A.players.length;
        const text: Record<string, string> = {
          filling: `Lobby open: ${seated}/${A.size} seated, ${mm(A.left)} left`,
          confirming: `Continue with fewer players? ${mm(A.left)} left`,
          finishable: 'Lobby ended: anyone can lock the match',
          trading: `TRADING: ${mm(A.left)} left`,
          ended: 'Time is up: press Settle',
          settled: A.result === 3 ? 'Tie: everyone is refunded' : A.result === 1 ? 'BULLS WIN' : 'BEARS WIN',
          cancelled: 'Cancelled: stakes are refundable',
        };
        c.fillStyle = '#f8fafc'; c.font = 'bold 84px system-ui, sans-serif'; c.fillText(A.id, cw / 2, ch * 0.28);
        c.fillStyle = A.phase === 'trading' ? '#34d399' : A.phase === 'settled' ? (A.result === 1 ? '#34d399' : A.result === 2 ? '#fb7185' : '#fbbf24') : '#fbbf24';
        c.font = 'bold 60px system-ui, sans-serif'; c.fillText(text[A.phase] ?? A.phase, cw / 2, ch * 0.62);
        c.fillStyle = '#94a3b8'; c.font = '36px system-ui, sans-serif';
        c.fillText(A.phase === 'filling' || A.phase === 'confirming' ? 'Your team is drawn at random the moment you sit. Nobody picks a side.' : 'Both teams trade freely. Better average vault gain wins.', cw / 2, ch * 0.86);
      }, 0, 4.2, -d / 2 + 0.3);
      const bar = sign(9, 1.6, 1280, (c, cw, ch) => {
        const A = live.current.arena;
        c.fillStyle = 'rgba(8,15,30,0.94)'; c.fillRect(0, 0, cw, ch);
        const hasScores = !!A && A.bulls !== null && A.bears !== null && (A.phase === 'trading' || A.phase === 'ended' || A.phase === 'settled');
        const bx = 60, bw = cw - 120, by = ch * 0.5, bh = 36;
        c.fillStyle = '#9f1239'; c.fillRect(bx, by, bw, bh);
        let fillW = bw / 2;
        if (hasScores) {
          const gap = (A!.bulls as number) - (A!.bears as number);
          fillW = bw * (0.5 + 0.5 * Math.max(-1, Math.min(1, gap / 100)));
        }
        c.fillStyle = '#059669'; c.fillRect(bx, by, fillW, bh);
        c.fillStyle = '#f8fafc'; c.fillRect(bx + fillW - 6, by - 12, 12, bh + 24);
        c.textBaseline = 'middle'; c.font = 'bold 44px system-ui, sans-serif';
        c.textAlign = 'left'; c.fillStyle = '#34d399'; c.fillText(hasScores ? `BULLS ${(A!.bulls as number) >= 0 ? '+' : ''}${(A!.bulls as number).toFixed(2)} USDso` : 'BULLS', bx, ch * 0.22);
        c.textAlign = 'right'; c.fillStyle = '#fb7185'; c.fillText(hasScores ? `BEARS ${(A!.bears as number) >= 0 ? '+' : ''}${(A!.bears as number).toFixed(2)} USDso` : 'BEARS', bx + bw, ch * 0.22);
        c.textAlign = 'center'; c.fillStyle = '#94a3b8'; c.font = '30px system-ui, sans-serif';
        c.fillText(hasScores ? 'Average vault gain per team, read from the chain' : 'The rope moves once the match locks and teams trade', cw / 2, ch * 0.88);
      }, 0, 2.2, -d / 2 + 0.3);

      // who stands where: re-laid out only when the roster, phase or loaded models change
      ticks.push(() => {
        const A = live.current.arena;
        const next = JSON.stringify([A?.id, A?.phase, A?.size, A?.result, A?.bulls, A?.bears, Math.floor(A?.left ?? 0), A?.players.map((p) => [p.team, p.isMe]), ready]);
        if (next === sig) return;
        sig = next;
        const players = A?.players ?? [];
        const locked = players.some((p) => p.team !== 0);
        const lists: Record<number, { isMe: boolean }[]> = { 1: [], 2: [] };
        const waiting: { isMe: boolean }[] = [];
        players.forEach((p) => (p.team === 1 ? lists[1].push(p) : p.team === 2 ? lists[2].push(p) : waiting.push(p)));
        const total = Math.max(A?.size ?? 0, players.length);

        [bulls, bears].forEach((pool, pi) => {
          const roster = lists[pi + 1];
          pool.forEach((pu, i) => {
            const pl = roster[i];
            pu.on = !!pl;
            pu.holder.visible = pu.on;
            pu.ring.visible = pu.on;
            if (!pl) return;
            pu.holder.position.set(pu.x, 0, pu.z);
            pu.ring.position.set(pu.x, 0.04, pu.z);
            if (!pu.human) { pu.human = makeCharacter('human'); pu.human.group.visible = false; pu.holder.add(pu.human.group); }
            (pu.ring.material as THREE.MeshBasicMaterial).color.setHex(pl.isMe ? 0xfacc15 : pi === 0 ? 0x10b981 : 0xf43f5e);
            const t = pu.sx < 0 ? 1 : 2;
            const base = tpl[t];
            if (!pu.model && base) {
              const m = cloneSkinned(base);
              pu.holder.add(m);
              pu.model = m;
              pu.rig = makeRig(m);
              if (pu.rig) {
                const top = pu.rig.hipsY - pu.rig.thigh - 0.06; // the seat top sits just under the pelvis when seated
                pu.stool.scale.y = top;
                pu.stool.position.y = top / 2;
              }
              pu.peg.visible = !pu.rig;
              if (pu.rig) m.visible = true;
              else { pu.holder.remove(m); pu.model = null; }
            }
            pu.peg.visible = !pu.rig;
            pu.pegMat.color.setHex(pi === 0 ? 0x10b981 : 0xf43f5e);
            // face the rope, each row turned a little toward it
            pu.holder.rotation.y = (pu.sx < 0 ? Math.PI / 2 : -Math.PI / 2) - pu.sx * 0.3 * Math.sign(pu.z);
          });
        });
        // the neutral lobby line (before the lock) or the empty seats
        lobby.forEach((lb, i) => {
          const x = (i - (total - 1) / 2) * 1.2;
          const pl = !locked ? waiting[i] : undefined;
          lb.g.position.set(x, 0, 4.2);
          lb.g.visible = !!pl;
          lb.ring.visible = !locked && i < total;
          lb.ring.position.set(x, 0.04, 4.2);
          lb.mat.color.setHex(0xcbd5e1);
          (lb.ring.material as THREE.MeshBasicMaterial).color.setHex(pl?.isMe ? 0xfacc15 : 0x64748b);
        });
        board.redraw();
        bar.redraw();
      });

      // every frame: the rope slides with the score, sags, and the arms reach its real position
      let ropeOffset = 0;
      let rv = 0;
      let lastKick = -1;
      const tmp = new THREE.Vector3();
      frames.push((t, dt) => {
        const A = live.current.arena;
        const hasScores = !!A && A.bulls !== null && A.bears !== null && (A.phase === 'trading' || A.phase === 'ended' || A.phase === 'settled');
        const gap = hasScores ? (A!.bulls as number) - (A!.bears as number) : 0;
        const bias = Math.max(-1, Math.min(1, gap / Math.max(0.5, A?.scale ?? 5))); // +1 Bulls, -1 Bears
        const trading = A?.phase === 'trading';
        // a real rope: a spring pulled toward where the score says, with damping, and the teams heave in surges
        if (A && A.kick > lastKick) { if (lastKick >= 0 && A.myTeam) rv += (A.myTeam === 1 ? -1 : 1) * 0.5; lastKick = A.kick; }
        if (!A) lastKick = -1; else if (lastKick < 0) lastKick = A.kick;
        const heave = 0; // the rope only ever moves toward whoever is winning: no back-and-forth
        const dtc = Math.min(dt, 0.05);
        rv += (4 * (-bias * 3 + heave - ropeOffset) - 4.2 * rv) * dtc; // overdamped: it glides, never rocks
        ropeOffset += rv * dtc;
        team.position.x = ropeOffset;
        // while the lobby is open the players sit; when the match runs they stand and pull
        const seatedNow = A?.phase === 'filling' || A?.phase === 'confirming' || A?.phase === 'finishable';
        const intensity = trading ? 0.4 + Math.abs(bias) * 0.6 : A?.phase === 'filling' ? 0.15 : 0.1;
        ropeLift = 0.55 + 0.4 * Math.min(1, intensity + Math.abs(bias) * 0.3); // tension lifts the rope off the floor
        if (ropeBones) {
          ropeBones.l.forEach((b, k) => { b.rotation.z = -bend(k); });
          ropeBones.r.forEach((b, k) => { b.rotation.z = bend(k); });
        }
        team.updateMatrixWorld(true);
        [bulls, bears].forEach((pool, pi) =>
          pool.forEach((pu) => {
            if (!pu.on) return;
            // waiting in the lobby: a person sits on a chair. Once the match runs, the animal stands and pulls.
            if (pu.human) { pu.human.group.visible = seatedNow; pu.chair.visible = seatedNow; }
            if (pu.model) pu.model.visible = !seatedNow;
            pu.peg.visible = !pu.rig && !seatedNow;
            pu.stool.visible = false;
            if (seatedNow && pu.human) {
              const h = pu.human;
              h.group.position.set(0, 0.5 - 0.92 + 0.02, -0.04);
              h.legL.rotation.x = -1.4; h.legR.rotation.x = -1.4;
              h.armL.rotation.x = -0.7; h.armR.rotation.x = -0.7;
              h.group.rotation.x = Math.sin(t * 1.3 + pu.phase) * 0.012;
              return;
            }
            if (!pu.rig) return;
            const winning = pi === 0 ? bias > 0.05 : bias < -0.05;
            const losing = pi === 0 ? bias < -0.05 : bias > 0.05;
            const rg = pu.rig;
            if (seatedNow) {
              // thighs forward, shins down, hands resting on the knees
              rg.hips.position.y = rg.hipsY - rg.thigh;
              rg.upLegL.rotation.x = -Math.PI / 2; rg.upLegR.rotation.x = -Math.PI / 2;
              rg.legL.rotation.x = Math.PI / 2; rg.legR.rotation.x = Math.PI / 2;
              rg.spine.rotation.x = 0; rg.chest.rotation.x = Math.sin(t * 1.3 + pu.phase) * 0.012;
              pu.holder.position.y = 0;
              pu.holder.updateMatrixWorld(true);
              const rest = (up: THREE.Object3D, restUp: THREE.Vector3, fore: THREE.Object3D, restFore: THREE.Vector3, knee: THREE.Object3D) => {
                const kw = knee.getWorldPosition(new THREE.Vector3());
                const sw = up.getWorldPosition(new THREE.Vector3());
                tmp.copy(sw).lerp(kw, 0.6);
                tmp.y += 0.05;
                aim(up, restUp, tmp.clone());
                aim(fore, restFore, kw);
              };
              rest(rg.upL, rg.restUpL, rg.foreL, rg.restForeL, rg.legL);
              rest(rg.upR, rg.restUpR, rg.foreR, rg.restForeR, rg.legR);
              return;
            }
            rg.hips.position.y = rg.hipsY;
            rg.upLegL.rotation.x = 0; rg.upLegR.rotation.x = 0; rg.legL.rotation.x = 0; rg.legR.rotation.x = 0;
            const lean = 0.1 + 0.16 * intensity + (winning ? 0.18 * Math.abs(bias) : 0) - (losing ? 0.05 * Math.abs(bias) : 0) + Math.sin(t * 5 + pu.phase) * (0.05 + Math.abs(rv) * 0.04) * intensity;
            rg.spine.rotation.x = -lean * 0.5;
            rg.chest.rotation.x = -lean * 0.5;
            pu.holder.position.y = Math.abs(Math.sin(t * 5 + pu.phase)) * 0.025 * intensity;
            pu.holder.updateMatrixWorld(true);
            const reach = (up: THREE.Object3D, restUp: THREE.Vector3, fore: THREE.Object3D, restFore: THREE.Vector3, forward: number) => {
              const gx = pu.x - pu.sx * forward;
              const grip = new THREE.Vector3(gx, ropeYAt(gx) + Math.sin(t * 6 + pu.phase) * 0.02 * intensity, 0);
              team.localToWorld(grip);
              tmp.set(pu.x + pu.sx * 0.25, ropeYAt(gx) - 0.25, Math.sign(pu.z) * 0.25);
              team.localToWorld(tmp);
              aim(up, restUp, tmp);
              aim(fore, restFore, grip);
            };
            reach(rg.upL, rg.restUpL, rg.foreL, rg.restForeL, 0.2);
            reach(rg.upR, rg.restUpR, rg.foreR, rg.restForeR, 0.55);
          }),
        );
      });

      exitPortal(-w / 2 + 2, d / 2 - 2, 'Leave to the market room', () => live.current.onBackToLobby());
      pos.set(0, d / 2 - 3);
      facing = Math.PI;
      void ticker;
    };

    const setRoom = (r: WorldRoom, from: WorldRoom | null) => {
      clearRoom();
      if (r.kind === 'hub') buildHub(from && from.kind === 'market' ? from.ticker : null);
      else if (r.kind === 'market') buildMarket(r.ticker);
      else if (live.current.squads) buildSquadArena(r.ticker);
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
      const spot = seatSpot;
      seatSpot = null; // set again every frame by the arena while I am seated
      if (spot && !unseated && len > 0.01) unseated = true;
      if (spot && !unseated) {
        pos.set(spot.x, spot.z);
        facing = spot.face;
        moving = Math.max(0, moving - dt * 8);
      } else if (len > 0.01) {
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
      const noHuman = L.room.kind === 'arena' && avatar.form === 'human'; // in a match the only figures are the bulls and bears
      avatar.group.visible = !(spot && !unseated) && !noHuman; // my own puller on the rope stands in for me
      shadow.visible = !noHuman;
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
