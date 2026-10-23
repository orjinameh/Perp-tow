'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  TrendingUp,
  TrendingDown,
  Maximize2,
  Minimize2,
  RotateCcw,
  Eye,
  Activity,
  Zap,
} from 'lucide-react';
import { CryptoAsset, PositionSide } from '@/lib/types';

interface ThreeTugOfWarArenaProps {
  bullsCount: number;
  bearsCount: number;
  marketTicker: CryptoAsset;
  marketPrice?: number;
  selectedSide?: PositionSide | null;
  interactive?: boolean;
  onAdjustBulls?: (count: number) => void;
  onAdjustBears?: (count: number) => void;
}

export const ThreeTugOfWarArena: React.FC<ThreeTugOfWarArenaProps> = ({
  bullsCount,
  bearsCount,
  marketTicker,
  marketPrice,
  selectedSide = null,
  interactive = true,
  onAdjustBulls,
  onAdjustBears,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [cameraPreset, setCameraPreset] = useState<'side' | 'bull' | 'bear' | 'top'>('side');
  const [isLivePulling, setIsLivePulling] = useState(true);

  // Mutable refs for animation loop
  const stateRef = useRef({
    bulls: bullsCount,
    bears: bearsCount,
    shift: 0,
    targetShift: 0,
    isLivePulling: true,
    cameraPreset: 'side' as 'side' | 'bull' | 'bear' | 'top',
  });

  // Sync state into ref for 60fps render loop
  useEffect(() => {
    stateRef.current.bulls = bullsCount;
    stateRef.current.bears = bearsCount;
    const total = Math.max(1, bullsCount + bearsCount);
    // Normalized bias between -1 (Bears total) and +1 (Bulls total)
    // Shift in 3D world units: negative X is Left (Bulls), positive X is Right (Bears)
    const bias = (bullsCount - bearsCount) / total;
    stateRef.current.targetShift = -bias * 3.8; // Bull advantage pulls toward -X (left)
  }, [bullsCount, bearsCount]);

  useEffect(() => {
    stateRef.current.isLivePulling = isLivePulling;
  }, [isLivePulling]);

  useEffect(() => {
    stateRef.current.cameraPreset = cameraPreset;
  }, [cameraPreset]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 1. Detect Software WebGL
    const isSoftwareGl = (() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    // 2. Setup Three.js Scene, Camera, Renderer
    const width = container.clientWidth || 800;
    const height = container.clientHeight || 450;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x161b26);
    scene.fog = new THREE.Fog(0x161b26, 16, 45);

    const camera = new THREE.PerspectiveCamera(44, width / height, 0.1, 100);
    camera.position.set(0, 5.4, 18.5);

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
      alpha: false,
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.65;
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.maxPolarAngle = Math.PI / 2 - 0.04;
    controls.minDistance = 6;
    controls.maxDistance = 32;
    controls.target.set(0, 1.2, 0);

    let isUserInteracting = false;
    controls.addEventListener('start', () => { isUserInteracting = true; });
    controls.addEventListener('end', () => { isUserInteracting = false; });

    // 3. Bright Studio Stadium Lighting Rig
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x475569, 1.3);
    scene.add(hemiLight);

    const dirKeyLight = new THREE.DirectionalLight(0xffffff, 2.5);
    dirKeyLight.position.set(5, 14, 9);
    dirKeyLight.castShadow = !isSoftwareGl;
    if (!isSoftwareGl) {
      dirKeyLight.shadow.mapSize.width = 1024;
      dirKeyLight.shadow.mapSize.height = 1024;
      dirKeyLight.shadow.bias = -0.0005;
      dirKeyLight.shadow.camera.near = 1;
      dirKeyLight.shadow.camera.far = 25;
      dirKeyLight.shadow.camera.left = -10;
      dirKeyLight.shadow.camera.right = 10;
      dirKeyLight.shadow.camera.top = 8;
      dirKeyLight.shadow.camera.bottom = -4;
    }
    scene.add(dirKeyLight);

    // Front Secondary Fill Light for clear visibility
    const dirFillLight = new THREE.DirectionalLight(0xf1f5f9, 1.5);
    dirFillLight.position.set(-6, 10, 8);
    scene.add(dirFillLight);

    // Bull Spot (Emerald Rim)
    const bullSpot = new THREE.PointLight(0x34d399, 4.5, 20);
    bullSpot.position.set(-7, 4, 3);
    scene.add(bullSpot);

    // Bear Spot (Crimson Rim)
    const bearSpot = new THREE.PointLight(0xfb7185, 4.5, 20);
    bearSpot.position.set(7, 4, 3);
    scene.add(bearSpot);

    // Center Gold Marker Light
    const centerSpot = new THREE.PointLight(0xfde047, 3.5, 12);
    centerSpot.position.set(0, 3, 1);
    scene.add(centerSpot);

    // 4. Procedural Arena Floor & Runway
    const arenaGroup = new THREE.Group();
    scene.add(arenaGroup);

    // Circular base stadium platform (expansive surface)
    const platformGeo = new THREE.CylinderGeometry(14, 14.5, 0.4, 64);
    const platformMat = new THREE.MeshStandardMaterial({
      color: 0x242d3d,
      roughness: 0.4,
      metalness: 0.3,
    });
    const platform = new THREE.Mesh(platformGeo, platformMat);
    platform.position.y = -0.2;
    platform.receiveShadow = !isSoftwareGl;
    arenaGroup.add(platform);

    // Glowing Arena Runway Strip
    const runwayGeo = new THREE.PlaneGeometry(28, 4.2);
    const runwayMat = new THREE.MeshStandardMaterial({
      color: 0x161922,
      roughness: 0.5,
      metalness: 0.6,
    });
    const runway = new THREE.Mesh(runwayGeo, runwayMat);
    runway.rotation.x = -Math.PI / 2;
    runway.position.y = 0.01;
    runway.receiveShadow = !isSoftwareGl;
    arenaGroup.add(runway);

    // Floor hashes / distance ticks (-12 to +12 meters)
    for (let x = -12; x <= 12; x += 1.2) {
      const isCenter = Math.abs(x) < 0.2;
      const isBullSide = x < -0.2;
      const tickGeo = new THREE.PlaneGeometry(0.08, isCenter ? 2.8 : 1.4);
      const tickMat = isCenter
        ? new THREE.MeshBasicMaterial({ color: 0xf59e0b })
        : isBullSide
        ? new THREE.MeshBasicMaterial({ color: 0x059669 })
        : new THREE.MeshBasicMaterial({ color: 0xe11d48 });
      const tick = new THREE.Mesh(tickGeo, tickMat);
      tick.rotation.x = -Math.PI / 2;
      tick.position.set(x, 0.02, 0);
      arenaGroup.add(tick);
    }

    // Team Bull Platform Ring (Left)
    const bullRingGeo = new THREE.RingGeometry(1.8, 2.0, 32);
    const bullRingMat = new THREE.MeshBasicMaterial({ color: 0x10b981, side: THREE.DoubleSide });
    const bullRing = new THREE.Mesh(bullRingGeo, bullRingMat);
    bullRing.rotation.x = -Math.PI / 2;
    bullRing.position.set(-8.5, 0.025, 0);
    arenaGroup.add(bullRing);

    // Team Bear Platform Ring (Right)
    const bearRingGeo = new THREE.RingGeometry(1.8, 2.0, 32);
    const bearRingMat = new THREE.MeshBasicMaterial({ color: 0xf43f5e, side: THREE.DoubleSide });
    const bearRing = new THREE.Mesh(bearRingGeo, bearRingMat);
    bearRing.rotation.x = -Math.PI / 2;
    bearRing.position.set(8.5, 0.025, 0);
    arenaGroup.add(bearRing);

    // 5. Procedural 3D Character Generators (Realistic 12-Part Sculpted Athletic Warriors)
    // Creates a realistic muscular, armored Bull Warrior in low athletic pulling stance
    function createBullPuller(index: number) {
      const charGroup = new THREE.Group();

      // Palette
      const armorEmerald = new THREE.MeshStandardMaterial({
        color: 0x059669,
        metalness: 0.6,
        roughness: 0.25,
      });
      const darkBodyMat = new THREE.MeshStandardMaterial({
        color: 0x022c22,
        roughness: 0.7,
        metalness: 0.2,
      });
      const goldTrimMat = new THREE.MeshStandardMaterial({
        color: 0xfde047,
        metalness: 0.9,
        roughness: 0.15,
        emissive: 0x854d0e,
        emissiveIntensity: 0.3,
      });
      const glowEyeMat = new THREE.MeshBasicMaterial({ color: 0x6ee7b7 });

      // 1. Pelvis & Armored Belt
      const pelvisGeo = new THREE.CylinderGeometry(0.24, 0.2, 0.25, 8);
      const pelvis = new THREE.Mesh(pelvisGeo, armorEmerald);
      pelvis.position.y = 0.58;
      pelvis.castShadow = !isSoftwareGl;
      charGroup.add(pelvis);

      // Gold Belt Buckle
      const buckleGeo = new THREE.BoxGeometry(0.12, 0.12, 0.08);
      const buckle = new THREE.Mesh(buckleGeo, goldTrimMat);
      buckle.position.set(0.18, 0.58, 0);
      charGroup.add(buckle);

      // 2. Muscular Abdomen & Tapered Ribcage
      const absGeo = new THREE.CylinderGeometry(0.3, 0.22, 0.35, 8);
      const abs = new THREE.Mesh(absGeo, darkBodyMat);
      abs.position.set(0.04, 0.82, 0);
      abs.castShadow = !isSoftwareGl;
      charGroup.add(abs);

      // 3. Heavy Chest Plate (Pectorals)
      const chestGeo = new THREE.BoxGeometry(0.55, 0.42, 0.48);
      const chest = new THREE.Mesh(chestGeo, armorEmerald);
      chest.position.set(0.08, 1.08, 0);
      chest.rotation.z = -0.15;
      chest.castShadow = !isSoftwareGl;
      charGroup.add(chest);

      // 4. Heavy Shoulder Pauldrons (Left & Right)
      const pauldronGeo = new THREE.SphereGeometry(0.18, 8, 8, 0, Math.PI * 2, 0, Math.PI / 1.6);
      const pauldronL = new THREE.Mesh(pauldronGeo, goldTrimMat);
      pauldronL.position.set(0.1, 1.25, 0.32);
      pauldronL.rotation.x = 0.4;
      charGroup.add(pauldronL);

      const pauldronR = new THREE.Mesh(pauldronGeo, goldTrimMat);
      pauldronR.position.set(0.1, 1.25, -0.32);
      pauldronR.rotation.x = -0.4;
      charGroup.add(pauldronR);

      // 5. Sculpted Bull Head & Horns
      const headGroup = new THREE.Group();
      headGroup.position.set(0.32, 1.35, 0);

      // Cranium
      const craniumGeo = new THREE.BoxGeometry(0.32, 0.34, 0.34);
      const cranium = new THREE.Mesh(craniumGeo, armorEmerald);
      headGroup.add(cranium);

      // Tapered Muzzle / Snout
      const muzzleGeo = new THREE.BoxGeometry(0.25, 0.22, 0.24);
      const muzzle = new THREE.Mesh(muzzleGeo, darkBodyMat);
      muzzle.position.set(0.24, -0.06, 0);
      headGroup.add(muzzle);

      // Glowing Eyes
      const eyeGeo = new THREE.BoxGeometry(0.06, 0.04, 0.08);
      const eyeL = new THREE.Mesh(eyeGeo, glowEyeMat);
      eyeL.position.set(0.16, 0.06, 0.16);
      headGroup.add(eyeL);

      const eyeR = new THREE.Mesh(eyeGeo, glowEyeMat);
      eyeR.position.set(0.16, 0.06, -0.16);
      headGroup.add(eyeR);

      // Sweeping Curved Horns (multi-segmented for realism)
      const hornCurveL = [
        new THREE.Vector3(0.05, 0.15, 0.16),
        new THREE.Vector3(0.12, 0.32, 0.36),
        new THREE.Vector3(0.24, 0.44, 0.32),
      ];
      const hornCurveR = [
        new THREE.Vector3(0.05, 0.15, -0.16),
        new THREE.Vector3(0.12, 0.32, -0.36),
        new THREE.Vector3(0.24, 0.44, -0.32),
      ];

      const hornGeoL = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(hornCurveL), 12, 0.045, 6, false);
      const hornL = new THREE.Mesh(hornGeoL, goldTrimMat);
      headGroup.add(hornL);

      const hornGeoR = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(hornCurveR), 12, 0.045, 6, false);
      const hornR = new THREE.Mesh(hornGeoR, goldTrimMat);
      headGroup.add(hornR);

      headGroup.castShadow = !isSoftwareGl;
      charGroup.add(headGroup);

      // 6. Dual Articulated Arms gripping the rope
      // Forearm 1 (Forward Grip)
      const armGeo1 = new THREE.CylinderGeometry(0.07, 0.08, 0.48);
      const armL = new THREE.Mesh(armGeo1, armorEmerald);
      armL.position.set(0.38, 1.05, 0.14);
      armL.rotation.z = -Math.PI / 3.2;
      armL.rotation.y = 0.2;
      charGroup.add(armL);

      // Gauntlet Hand Clamped on Rope
      const handGeo = new THREE.SphereGeometry(0.08, 6, 6);
      const handL = new THREE.Mesh(handGeo, goldTrimMat);
      handL.position.set(0.55, 0.94, 0.06);
      charGroup.add(handL);

      const armR = new THREE.Mesh(armGeo1, armorEmerald);
      armR.position.set(0.32, 1.02, -0.14);
      armR.rotation.z = -Math.PI / 3.5;
      armR.rotation.y = -0.2;
      charGroup.add(armR);

      const handR = new THREE.Mesh(handGeo, goldTrimMat);
      handR.position.set(0.48, 0.92, -0.06);
      charGroup.add(handR);

      // 7. Braced Athletic Legs & Cleated Boots
      // Lead Leg (Forward Bent)
      const thighGeo = new THREE.CylinderGeometry(0.1, 0.12, 0.4);
      const thighLead = new THREE.Mesh(thighGeo, darkBodyMat);
      thighLead.position.set(0.18, 0.4, 0.16);
      thighLead.rotation.z = -0.45;
      charGroup.add(thighLead);

      const calfGeo = new THREE.CylinderGeometry(0.09, 0.11, 0.4);
      const calfLead = new THREE.Mesh(calfGeo, armorEmerald);
      calfLead.position.set(0.28, 0.18, 0.16);
      calfLead.rotation.z = 0.3;
      charGroup.add(calfLead);

      // Boot
      const bootGeo = new THREE.BoxGeometry(0.24, 0.1, 0.14);
      const bootLead = new THREE.Mesh(bootGeo, goldTrimMat);
      bootLead.position.set(0.32, 0.05, 0.16);
      charGroup.add(bootLead);

      // Anchor Leg (Dug Deep Backwards for Leverage)
      const thighBack = new THREE.Mesh(thighGeo, darkBodyMat);
      thighBack.position.set(-0.16, 0.38, -0.16);
      thighBack.rotation.z = 0.4;
      charGroup.add(thighBack);

      const calfBack = new THREE.Mesh(calfGeo, armorEmerald);
      calfBack.position.set(-0.32, 0.16, -0.16);
      calfBack.rotation.z = -0.2;
      charGroup.add(calfBack);

      const bootBack = new THREE.Mesh(bootGeo, goldTrimMat);
      bootBack.position.set(-0.36, 0.05, -0.16);
      charGroup.add(bootBack);

      // Athletic pulling stance: Leaning back towards left (-X)
      // Positioned in side-by-side pairs along the rope:
      const row = Math.floor(index / 2);
      const isSideA = index % 2 === 0;
      const zOffset = isSideA ? 0.38 : -0.38;
      const xPos = -2.2 - row * 0.88 - (isSideA ? 0 : 0.14);
      charGroup.rotation.z = 0.36;
      charGroup.rotation.y = isSideA ? -0.12 : 0.12;
      charGroup.position.set(xPos, 0, zOffset);

      return charGroup;
    }

    // Creates a realistic muscular, armored Bear Warrior in low athletic pulling stance
    function createBearPuller(index: number) {
      const charGroup = new THREE.Group();

      // Palette
      const armorCrimson = new THREE.MeshStandardMaterial({
        color: 0xe11d48,
        metalness: 0.6,
        roughness: 0.25,
      });
      const darkFurMat = new THREE.MeshStandardMaterial({
        color: 0x4c0519,
        roughness: 0.75,
        metalness: 0.15,
      });
      const rubyTrimMat = new THREE.MeshStandardMaterial({
        color: 0xfb7185,
        metalness: 0.85,
        roughness: 0.15,
        emissive: 0x9f1239,
        emissiveIntensity: 0.3,
      });
      const glowRubyEyeMat = new THREE.MeshBasicMaterial({ color: 0xff6b81 });

      // 1. Heavy Pelvis & Battle Belt
      const pelvisGeo = new THREE.CylinderGeometry(0.26, 0.22, 0.28, 8);
      const pelvis = new THREE.Mesh(pelvisGeo, armorCrimson);
      pelvis.position.y = 0.6;
      pelvis.castShadow = !isSoftwareGl;
      charGroup.add(pelvis);

      // Ruby Belt Buckle
      const buckleGeo = new THREE.BoxGeometry(0.14, 0.14, 0.09);
      const buckle = new THREE.Mesh(buckleGeo, rubyTrimMat);
      buckle.position.set(-0.2, 0.6, 0);
      charGroup.add(buckle);

      // 2. Broad Grizzly Barrel Torso with Shoulder Hump
      const torsoGeo = new THREE.CylinderGeometry(0.35, 0.25, 0.42, 8);
      const torso = new THREE.Mesh(torsoGeo, darkFurMat);
      torso.position.set(-0.06, 0.86, 0);
      torso.castShadow = !isSoftwareGl;
      charGroup.add(torso);

      // Grizzly Upper Back Hump
      const humpGeo = new THREE.SphereGeometry(0.24, 8, 8);
      const hump = new THREE.Mesh(humpGeo, darkFurMat);
      hump.position.set(0.12, 1.18, 0);
      charGroup.add(hump);

      // Heavy Chest Plate & Back Armor
      const chestGeo = new THREE.BoxGeometry(0.6, 0.46, 0.52);
      const chest = new THREE.Mesh(chestGeo, armorCrimson);
      chest.position.set(-0.1, 1.12, 0);
      chest.rotation.z = 0.15;
      chest.castShadow = !isSoftwareGl;
      charGroup.add(chest);

      // 3. Spiked Shoulder Guards (Pauldrons)
      const pauldronGeo = new THREE.CylinderGeometry(0.12, 0.2, 0.18, 6);
      const pauldronL = new THREE.Mesh(pauldronGeo, rubyTrimMat);
      pauldronL.position.set(-0.12, 1.28, 0.34);
      pauldronL.rotation.x = 0.45;
      charGroup.add(pauldronL);

      const pauldronR = new THREE.Mesh(pauldronGeo, rubyTrimMat);
      pauldronR.position.set(-0.12, 1.28, -0.34);
      pauldronR.rotation.x = -0.45;
      charGroup.add(pauldronR);

      // 4. Fierce Sculpted Bear Head & Jaws
      const headGroup = new THREE.Group();
      headGroup.position.set(-0.36, 1.38, 0);

      // Heavy Cranium
      const craniumGeo = new THREE.BoxGeometry(0.36, 0.36, 0.38);
      const cranium = new THREE.Mesh(craniumGeo, armorCrimson);
      headGroup.add(cranium);

      // Broad Snout & Open Jaw
      const snoutGeo = new THREE.BoxGeometry(0.28, 0.22, 0.26);
      const snout = new THREE.Mesh(snoutGeo, darkFurMat);
      snout.position.set(-0.25, -0.06, 0);
      headGroup.add(snout);

      // Sharp Canine Fangs
      const fangMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const fangGeo = new THREE.ConeGeometry(0.03, 0.1, 4);
      const fangL = new THREE.Mesh(fangGeo, fangMat);
      fangL.position.set(-0.3, -0.15, 0.08);
      fangL.rotation.x = Math.PI;
      headGroup.add(fangL);

      const fangR = new THREE.Mesh(fangGeo, fangMat);
      fangR.position.set(-0.3, -0.15, -0.08);
      fangR.rotation.x = Math.PI;
      headGroup.add(fangR);

      // Rounded Bear Ears
      const earGeo = new THREE.SphereGeometry(0.09, 8, 8);
      const earL = new THREE.Mesh(earGeo, rubyTrimMat);
      earL.position.set(0.06, 0.22, 0.2);
      headGroup.add(earL);

      const earR = new THREE.Mesh(earGeo, rubyTrimMat);
      earR.position.set(0.06, 0.22, -0.2);
      headGroup.add(earR);

      // Glowing Ruby Eyes
      const eyeGeo = new THREE.BoxGeometry(0.06, 0.04, 0.08);
      const eyeL = new THREE.Mesh(eyeGeo, glowRubyEyeMat);
      eyeL.position.set(-0.18, 0.08, 0.18);
      headGroup.add(eyeL);

      const eyeR = new THREE.Mesh(eyeGeo, glowRubyEyeMat);
      eyeR.position.set(-0.18, 0.08, -0.18);
      headGroup.add(eyeR);

      charGroup.add(headGroup);

      // 5. Heavy Armored Arms & Paws Gripping the Rope
      const armGeo = new THREE.CylinderGeometry(0.08, 0.09, 0.5);
      const armL = new THREE.Mesh(armGeo, armorCrimson);
      armL.position.set(-0.4, 1.05, 0.14);
      armL.rotation.z = Math.PI / 3.2;
      armL.rotation.y = -0.2;
      charGroup.add(armL);

      const pawGeo = new THREE.SphereGeometry(0.09, 6, 6);
      const pawL = new THREE.Mesh(pawGeo, rubyTrimMat);
      pawL.position.set(-0.58, 0.94, 0.06);
      charGroup.add(pawL);

      const armR = new THREE.Mesh(armGeo, armorCrimson);
      armR.position.set(-0.34, 1.02, -0.14);
      armR.rotation.z = Math.PI / 3.5;
      armR.rotation.y = 0.2;
      charGroup.add(armR);

      const pawR = new THREE.Mesh(pawGeo, rubyTrimMat);
      pawR.position.set(-0.5, 0.92, -0.06);
      charGroup.add(pawR);

      // 6. Heavy Braced Bear Legs & Spiked Boots
      // Lead Leg
      const thighGeo = new THREE.CylinderGeometry(0.12, 0.14, 0.42);
      const thighLead = new THREE.Mesh(thighGeo, darkFurMat);
      thighLead.position.set(-0.2, 0.4, 0.18);
      thighLead.rotation.z = 0.45;
      charGroup.add(thighLead);

      const calfGeo = new THREE.CylinderGeometry(0.1, 0.12, 0.42);
      const calfLead = new THREE.Mesh(calfGeo, armorCrimson);
      calfLead.position.set(-0.3, 0.18, 0.18);
      calfLead.rotation.z = -0.3;
      charGroup.add(calfLead);

      const bootGeo = new THREE.BoxGeometry(0.26, 0.11, 0.16);
      const bootLead = new THREE.Mesh(bootGeo, rubyTrimMat);
      bootLead.position.set(-0.34, 0.06, 0.18);
      charGroup.add(bootLead);

      // Anchor Leg Dug Deep Backwards
      const thighBack = new THREE.Mesh(thighGeo, darkFurMat);
      thighBack.position.set(0.18, 0.38, -0.18);
      thighBack.rotation.z = -0.4;
      charGroup.add(thighBack);

      const calfBack = new THREE.Mesh(calfGeo, armorCrimson);
      calfBack.position.set(0.34, 0.16, -0.18);
      calfBack.rotation.z = 0.2;
      charGroup.add(calfBack);

      const bootBack = new THREE.Mesh(bootGeo, rubyTrimMat);
      bootBack.position.set(0.38, 0.06, -0.18);
      charGroup.add(bootBack);

      // Athletic pulling stance: Leaning back towards right (+X)
      // Positioned in side-by-side pairs along the rope:
      const row = Math.floor(index / 2);
      const isSideA = index % 2 === 0;
      const zOffset = isSideA ? 0.38 : -0.38;
      const xPos = 2.2 + row * 0.88 + (isSideA ? 0 : 0.14);
      charGroup.rotation.z = -0.36;
      charGroup.rotation.y = isSideA ? 0.12 : -0.12;
      charGroup.position.set(xPos, 0, zOffset);

      return charGroup;
    }

    // Dynamic Team Puller Arrays (Pool of up to 20 pullers per side)
    const bullTeamGroup = new THREE.Group();
    const bearTeamGroup = new THREE.Group();
    scene.add(bullTeamGroup);
    scene.add(bearTeamGroup);

    // Spawn up to 20 pullers for Bulls and Bears to accurately reflect roster (e.g. 13v7, 10v10, etc.)
    const bullPullers: THREE.Group[] = [];
    const bearPullers: THREE.Group[] = [];
    const MAX_PULLERS = 20;

    for (let i = 0; i < MAX_PULLERS; i++) {
      const b = createBullPuller(i);
      bullPullers.push(b);
      bullTeamGroup.add(b);

      const br = createBearPuller(i);
      bearPullers.push(br);
      bearTeamGroup.add(br);
    }

    // 6. The Braided Tug of War 3D Rope
    const ropeGroup = new THREE.Group();
    scene.add(ropeGroup);

    // Central Ribbon / Flag
    const ribbonGeo = new THREE.CylinderGeometry(0.04, 0.04, 1.2, 16);
    const ribbonMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      metalness: 0.9,
      roughness: 0.2,
      emissive: 0xf59e0b,
      emissiveIntensity: 0.35,
    });
    const ribbon = new THREE.Mesh(ribbonGeo, ribbonMat);
    ribbon.position.set(0, 0.7, 0);
    ropeGroup.add(ribbon);

    // Glowing center sphere
    const centerBallGeo = new THREE.SphereGeometry(0.16, 16, 16);
    const centerBallMat = new THREE.MeshStandardMaterial({
      color: 0xfbbf24,
      emissive: 0xfbbf24,
      emissiveIntensity: 0.6,
    });
    const centerBall = new THREE.Mesh(centerBallGeo, centerBallMat);
    centerBall.position.set(0, 1.1, 0);
    ropeGroup.add(centerBall);

    // Downward laser pointer pointing at the distance line
    const laserGeo = new THREE.CylinderGeometry(0.015, 0.015, 1.1);
    const laserMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.7 });
    const laser = new THREE.Mesh(laserGeo, laserMat);
    laser.position.set(0, 0.55, 0);
    ropeGroup.add(laser);

    // The braided rope tube (bright warm golden amber with highlight glow)
    let ropeMesh: THREE.Mesh | null = null;
    const ropeMat = new THREE.MeshStandardMaterial({
      color: 0xfbbf24,
      roughness: 0.35,
      metalness: 0.25,
      emissive: 0xd97706,
      emissiveIntensity: 0.25,
    });

    function updateRopeCurve(shift: number, sag: number, bulls: number, bears: number) {
      if (ropeMesh) {
        ropeGroup.remove(ropeMesh);
        ropeMesh.geometry.dispose();
      }

      // Dynamically calculate rope span based on active roster count
      const bullRows = Math.max(1, Math.ceil(bulls / 2));
      const bearRows = Math.max(1, Math.ceil(bears / 2));
      const bullEnd = Math.min(-7.5, -2.2 - bullRows * 0.88 - 2.2) + shift * 0.4;
      const bearEnd = Math.max(7.5, 2.2 + bearRows * 0.88 + 2.2) + shift * 0.4;

      const points = [
        new THREE.Vector3(bullEnd, 1.05, 0),
        new THREE.Vector3(bullEnd * 0.5 + shift * 0.5, 1.12 - sag * 0.05, 0),
        new THREE.Vector3(shift, 1.1 - sag * 0.1, 0),
        new THREE.Vector3(bearEnd * 0.5 + shift * 0.5, 1.12 - sag * 0.05, 0),
        new THREE.Vector3(bearEnd, 1.05, 0),
      ];

      const curve = new THREE.CatmullRomCurve3(points);
      const ropeGeo = new THREE.TubeGeometry(curve, 48, 0.065, 8, false);
      ropeMesh = new THREE.Mesh(ropeGeo, ropeMat);
      ropeMesh.castShadow = !isSoftwareGl;
      ropeGroup.add(ropeMesh);
    }

    updateRopeCurve(0, 0, stateRef.current.bulls, stateRef.current.bears);

    // 7. Spark / Dust Particle System
    const particleCount = isSoftwareGl ? 15 : 45;
    const particleGeo = new THREE.BufferGeometry();
    const particlePositions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount * 3; i += 3) {
      particlePositions[i] = (Math.random() - 0.5) * 12;
      particlePositions[i + 1] = Math.random() * 1.5;
      particlePositions[i + 2] = (Math.random() - 0.5) * 2;
    }
    particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
    const particleMat = new THREE.PointsMaterial({
      size: 0.08,
      color: 0x34d399,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
    });
    const particles = new THREE.Points(particleGeo, particleMat);
    scene.add(particles);

    // 8. Animation & Physics Loop
    let animationFrameId = 0;
    const clock = new THREE.Clock();

    const animate = () => {
      const delta = Math.min(clock.getDelta(), 0.1);
      const elapsed = clock.getElapsedTime();

      // Dynamic heave pulling oscillations based on team momentum
      const bulls = stateRef.current.bulls;
      const bears = stateRef.current.bears;
      const total = Math.max(1, bulls + bears);
      const bullStrength = bulls / total;
      const bearStrength = bears / total;

      // Heave pulses (tug pulse frequency)
      const heave = stateRef.current.isLivePulling
        ? Math.sin(elapsed * 4.5) * 0.08 * (bullStrength > bearStrength ? -1 : 1)
        : 0;

      // Smooth exponential damping toward target shift
      const currentShift = stateRef.current.shift;
      const targetWithHeave = stateRef.current.targetShift + heave;
      const smoothedShift = THREE.MathUtils.damp(currentShift, targetWithHeave, 3.5, delta);
      stateRef.current.shift = smoothedShift;

      // Move Center Ribbon and Center Spot
      ribbon.position.x = smoothedShift;
      centerBall.position.x = smoothedShift;
      laser.position.x = smoothedShift;
      centerSpot.position.x = smoothedShift;

      // Update Dynamic Rope Geometry covering all active pullers
      const ropeSag = 0.2 + Math.abs(Math.sin(elapsed * 3)) * 0.05;
      updateRopeCurve(smoothedShift, ropeSag, bulls, bears);

      // Move puller teams physically with the rope
      bullTeamGroup.position.x = smoothedShift * 0.5;
      bearTeamGroup.position.x = smoothedShift * 0.5;

      // Dynamically show the exact number of Bulls and Bears (e.g., 13 Bulls and 7 Bears side-by-side)
      bullPullers.forEach((bp, idx) => {
        const strain = Math.sin(elapsed * 5 + idx * 0.7) * 0.08;
        bp.rotation.z = 0.35 + strain * (bullStrength + 0.5);
        bp.visible = idx < bulls;
      });

      bearPullers.forEach((brp, idx) => {
        const strain = Math.sin(elapsed * 5 + idx * 0.7 + Math.PI) * 0.08;
        brp.rotation.z = -0.35 - strain * (bearStrength + 0.5);
        brp.visible = idx < bears;
      });

      // Animate Spark particles
      const positions = particleGeo.attributes.position.array as Float32Array;
      for (let i = 0; i < particleCount * 3; i += 3) {
        positions[i + 1] -= delta * 0.8;
        if (positions[i + 1] < 0) {
          positions[i] = smoothedShift + (Math.random() - 0.5) * 4;
          positions[i + 1] = 1.2 + Math.random() * 0.5;
          positions[i + 2] = (Math.random() - 0.5) * 1.5;
        }
      }
      particleGeo.attributes.position.needsUpdate = true;

      // Smooth Camera Transitions between Presets
      const preset = stateRef.current.cameraPreset;
      let targetCamPos = new THREE.Vector3(0, 5.4, 18.5);
      let targetLookAt = new THREE.Vector3(smoothedShift * 0.4, 1.2, 0);

      if (preset === 'bull') {
        targetCamPos.set(-11, 4.0, 6.5);
        targetLookAt.set(smoothedShift, 1.2, 0);
      } else if (preset === 'bear') {
        targetCamPos.set(11, 4.0, 6.5);
        targetLookAt.set(smoothedShift, 1.2, 0);
      } else if (preset === 'top') {
        targetCamPos.set(0, 16.5, 4);
        targetLookAt.set(smoothedShift * 0.4, 0, 0);
      }

      if (!isUserInteracting) {
        // Only damp camera when user is not manually orbiting
        camera.position.lerp(targetCamPos, 0.04);
        controls.target.lerp(targetLookAt, 0.05);
      }

      controls.update();
      renderer.render(scene, camera);
      animationFrameId = requestAnimationFrame(animate);
    };

    animate();

    // 9. Resize Handling
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    window.addEventListener('resize', handleResize);

    // 10. Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
      controls.dispose();
      renderer.dispose();
      if (container && renderer.domElement) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  // Compute live visual metrics
  const total = Math.max(1, bullsCount + bearsCount);
  const bullPercent = Math.round((bullsCount / total) * 100);
  const bearPercent = 100 - bullPercent;
  const leadSide = bullsCount > bearsCount ? 'Bulls Lead' : bearsCount > bullsCount ? 'Bears Lead' : 'Even Tension';
  const pullDistance = Math.abs((bullsCount - bearsCount) / total * 3.8).toFixed(1);

  return (
    <div
      className={`relative w-full rounded-3xl border border-zinc-800 bg-zinc-950 overflow-hidden shadow-2xl transition-all duration-300 ${
        isFullscreen ? 'fixed inset-2 sm:inset-4 z-50 rounded-2xl h-[calc(100vh-1rem)] sm:h-[calc(100vh-2rem)]' : 'h-[340px] sm:h-[440px] md:h-[500px]'
      }`}
    >
      {/* 3D Canvas Mount Point */}
      <div ref={containerRef} className="absolute inset-0 w-full h-full cursor-grab active:cursor-grabbing touch-none" />

      {/* Top HUD: Responsive Status & Match Direction Telemetry */}
      <div className="absolute top-3 left-3 right-3 flex items-start sm:items-center justify-between pointer-events-none gap-2 z-10">
        <div className="flex items-center gap-2 bg-zinc-900/90 border border-zinc-800/90 px-2.5 py-1.5 sm:px-3.5 sm:py-1.5 rounded-xl backdrop-blur-md pointer-events-auto shadow-lg max-w-[65%] sm:max-w-none">
          <div className="flex h-5 w-5 sm:h-6 sm:w-6 items-center justify-center rounded-lg bg-emerald-500/20 text-[10px] sm:text-[11px] font-black text-emerald-400 font-mono shrink-0">
            3D
          </div>
          <div className="truncate">
            <div className="text-[11px] sm:text-xs font-bold text-white flex items-center gap-1.5 truncate">
              <span className="truncate">{marketTicker} Arena</span>
              <span className="text-[9px] sm:text-[10px] text-zinc-500 font-mono hidden xs:inline">20-Player</span>
            </div>
            <div className="text-[9px] sm:text-[10px] text-zinc-400 font-mono truncate">
              <span className={bullsCount >= bearsCount ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold'}>{leadSide}</span> ({pullDistance}m pull)
            </div>
          </div>
        </div>

        {/* View Controls & Fullscreen */}
        <div className="flex items-center gap-1.5 pointer-events-auto shrink-0">
          {/* Desktop/Tablet Camera preset buttons */}
          <div className="hidden md:flex items-center gap-1 bg-zinc-900/90 border border-zinc-800 p-1 rounded-xl backdrop-blur-md text-xs">
            {(['side', 'bull', 'bear', 'top'] as const).map((view) => (
              <button
                key={view}
                onClick={() => setCameraPreset(view)}
                className={`px-2 py-0.5 rounded-lg capitalize transition-colors text-[10px] font-medium ${
                  cameraPreset === view
                    ? 'bg-zinc-800 text-white font-semibold shadow-sm'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                {view}
              </button>
            ))}
          </div>

          {/* Mobile Camera Toggle Button */}
          <div className="md:hidden flex items-center bg-zinc-900/90 border border-zinc-800 rounded-xl p-0.5 backdrop-blur-md">
            <button
              onClick={() => {
                const nextPreset: Record<'side' | 'bull' | 'bear' | 'top', 'side' | 'bull' | 'bear' | 'top'> = {
                  side: 'bull',
                  bull: 'bear',
                  bear: 'top',
                  top: 'side',
                };
                setCameraPreset(nextPreset[cameraPreset]);
              }}
              className="flex items-center gap-1 px-2 py-1 text-[10px] text-zinc-200 font-mono uppercase"
              title="Cycle Camera View"
            >
              <Eye className="h-3 w-3 text-emerald-400" />
              <span>{cameraPreset}</span>
            </button>
          </div>

          <button
            onClick={() => setIsLivePulling((p) => !p)}
            title={isLivePulling ? 'Pause heave oscillation' : 'Resume live heave oscillation'}
            className={`flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-xl border transition-colors ${
              isLivePulling
                ? 'border-emerald-500/40 bg-emerald-950/70 text-emerald-400'
                : 'border-zinc-800 bg-zinc-900/90 text-zinc-400'
            }`}
          >
            <Zap className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
          </button>

          <button
            onClick={() => setIsFullscreen((f) => !f)}
            title={isFullscreen ? 'Exit Fullscreen' : 'Expand Arena Fullscreen'}
            className="flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/90 text-zinc-400 hover:text-white transition-colors"
          >
            {isFullscreen ? <Minimize2 className="h-3 w-3 sm:h-3.5 sm:w-3.5" /> : <Maximize2 className="h-3 w-3 sm:h-3.5 sm:w-3.5" />}
          </button>
        </div>
      </div>

      {/* Floating Team Anchor Overlays (Adaptive on mobile) */}
      <div className="absolute left-2.5 sm:left-4 bottom-8 sm:bottom-6 pointer-events-none z-10">
        <div className="flex items-center gap-1.5 sm:gap-2.5 bg-zinc-950/85 border border-emerald-500/40 px-2 py-1.5 sm:px-3 sm:py-2 rounded-xl backdrop-blur-md shadow-lg">
          <div className="h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981] shrink-0" />
          <div>
            <div className="text-[10px] sm:text-xs font-bold text-emerald-400 flex items-center gap-1">
              <TrendingUp className="h-3 w-3" />
              <span className="hidden xs:inline">BULLS</span>
              <span className="xs:hidden">BULL</span>
            </div>
            <div className="text-[9px] sm:text-[11px] text-zinc-300 font-mono">
              {bullsCount} <span className="text-zinc-500 hidden sm:inline">({bullPercent}%)</span>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute right-2.5 sm:right-4 bottom-8 sm:bottom-6 pointer-events-none text-right z-10">
        <div className="flex items-center gap-1.5 sm:gap-2.5 bg-zinc-950/85 border border-rose-500/40 px-2 py-1.5 sm:px-3 sm:py-2 rounded-xl backdrop-blur-md shadow-lg">
          <div>
            <div className="text-[10px] sm:text-xs font-bold text-rose-400 flex items-center justify-end gap-1">
              <span className="hidden xs:inline">BEARS</span>
              <span className="xs:hidden">BEAR</span>
              <TrendingDown className="h-3 w-3" />
            </div>
            <div className="text-[9px] sm:text-[11px] text-zinc-300 font-mono">
              {bearsCount} <span className="text-zinc-500 hidden sm:inline">({bearPercent}%)</span>
            </div>
          </div>
          <div className="h-2.5 w-2.5 rounded-full bg-rose-500 shadow-[0_0_8px_#f43f5e] shrink-0" />
        </div>
      </div>

      {/* Center Guidance Help */}
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 pointer-events-none z-10 w-full px-4 text-center">
        <div className="inline-flex text-[9px] sm:text-[10px] text-zinc-400 bg-zinc-950/85 border border-zinc-800/80 px-2.5 py-0.5 sm:px-3 sm:py-1 rounded-full backdrop-blur-md font-mono">
          {bullsCount === bearsCount ? (
            <span className="text-emerald-400 font-semibold">
              ✓ Teams Matched 1:1 ({bullsCount} Bulls vs {bearsCount} Bears) · Side by side · Drag to orbit 360°
            </span>
          ) : (
            <span>
              {bullsCount} Bulls vs {bearsCount} Bears · Rendered side-by-side along rope · Drag to orbit 360°
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
