import React, { useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';

export type SceneState = 'overview' | 'monitor' | 'optimize' | 'maintain' | 'healthcheck' | 'migrate';

interface InfraNode {
  id: string;
  label: string;
  sublabel: string;
  position: [number, number, number];
  color: number;
  accentColor: number;
}

interface Scene3DProps {
  sceneState?: SceneState;
  onNodeHover?: (node: InfraNode | null) => void;
  onNodeClick?: (node: InfraNode) => void;
  className?: string;
}

// Infrastructure nodes — meaningful topology
// Core at center, nodes arranged in a logical cloud architecture
const INFRA_NODES: InfraNode[] = [
  {
    id: 'compute',
    label: 'COMPUTE',
    sublabel: 'EC2 / ECS workload health',
    position: [-2.6, 1.0, 0.3],
    color: 0x2563eb,
    accentColor: 0x3b82f6,
  },
  {
    id: 'storage',
    label: 'STORAGE',
    sublabel: 'EBS / S3 storage efficiency',
    position: [2.7, 0.8, -0.2],
    color: 0x0891b2,
    accentColor: 0x06b6d4,
  },
  {
    id: 'database',
    label: 'DATABASE',
    sublabel: 'RDS availability & I/O',
    position: [0.0, -2.4, 0.5],
    color: 0x1e40af,
    accentColor: 0x3b82f6,
  },
  {
    id: 'monitoring',
    label: 'MONITORING',
    sublabel: 'CloudWatch visibility & alerting',
    position: [-2.5, -1.1, -0.4],
    color: 0x0d9488,
    accentColor: 0x14b8a6,
  },
  {
    id: 'cost',
    label: 'COST',
    sublabel: 'Cloud spend efficiency',
    position: [2.4, -1.2, 0.6],
    color: 0x7c3aed,
    accentColor: 0x8b5cf6,
  },
  {
    id: 'reliability',
    label: 'RELIABILITY',
    sublabel: 'Multi-AZ resilience & backups',
    position: [0.4, 2.6, -0.3],
    color: 0x047857,
    accentColor: 0x059669,
  },
];

// Which nodes are highlighted per scene state
const STATE_HIGHLIGHTS: Record<SceneState, string[]> = {
  overview: [],
  monitor: ['monitoring', 'compute', 'database'],
  optimize: ['cost', 'storage', 'compute'],
  maintain: ['reliability', 'database', 'monitoring'],
  healthcheck: ['compute', 'storage', 'database', 'monitoring', 'cost', 'reliability'],
  migrate: ['compute', 'database', 'storage'],
};

export const Scene3D: React.FC<Scene3DProps> = ({
  sceneState = 'overview',
  onNodeHover,
  onNodeClick,
  className = '',
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef(sceneState);
  const hoverCallbackRef = useRef(onNodeHover);
  const clickCallbackRef = useRef(onNodeClick);

  // Keep refs in sync without re-running effect
  useEffect(() => { stateRef.current = sceneState; }, [sceneState]);
  useEffect(() => { hoverCallbackRef.current = onNodeHover; }, [onNodeHover]);
  useEffect(() => { clickCallbackRef.current = onNodeClick; }, [onNodeClick]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // ── WebGL check ──────────────────────────────────────────
    const testCanvas = document.createElement('canvas');
    const gl = testCanvas.getContext('webgl') || testCanvas.getContext('experimental-webgl');
    if (!gl) return; // Fallback rendered via JSX below

    // ── Scene setup ──────────────────────────────────────────
    const W = mount.clientWidth;
    const H = mount.clientHeight;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'default',
    });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.shadowMap.enabled = true;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    // Very subtle warm-white fog for depth
    scene.fog = new THREE.FogExp2(0xf7f8fa, 0.018);

    const camera = new THREE.PerspectiveCamera(46, W / H, 0.1, 100);
    camera.position.set(0, 0.5, 10.5);
    camera.lookAt(0, 0, 0);

    // ── Lighting ─────────────────────────────────────────────
    // Key light (warm upper-left)
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.0);
    keyLight.position.set(-4, 8, 6);
    keyLight.castShadow = true;
    scene.add(keyLight);

    // Fill light (cool right)
    const fillLight = new THREE.DirectionalLight(0xdbeafe, 1.2);
    fillLight.position.set(6, -2, 4);
    scene.add(fillLight);

    // Ambient (very soft)
    const ambient = new THREE.AmbientLight(0xffffff, 1.8);
    scene.add(ambient);

    // Subtle blue point at center for depth
    const centerGlow = new THREE.PointLight(0x2563eb, 1.2, 10);
    centerGlow.position.set(0, 0, 1);
    scene.add(centerGlow);

    // ── Core (AWS Cloud platform) ─────────────────────────────
    const coreGroup = new THREE.Group();
    scene.add(coreGroup);

    // Core sphere — clean, solid, minimal
    const coreMat = new THREE.MeshStandardMaterial({
      color: 0x1e40af,
      metalness: 0.3,
      roughness: 0.4,
      transparent: true,
      opacity: 0.92,
    });
    const coreMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.85, 40, 40),
      coreMat
    );
    coreGroup.add(coreMesh);

    // Subtle outer ring around core
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x3b82f6,
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
    });
    const outerRing = new THREE.Mesh(
      new THREE.TorusGeometry(1.25, 0.03, 8, 60),
      ringMat
    );
    outerRing.rotation.x = Math.PI / 2.5;
    coreGroup.add(outerRing);

    // Second ring offset
    const ring2 = new THREE.Mesh(
      new THREE.TorusGeometry(1.45, 0.015, 8, 60),
      new THREE.MeshBasicMaterial({
        color: 0x93c5fd,
        transparent: true,
        opacity: 0.10,
        side: THREE.DoubleSide,
      })
    );
    ring2.rotation.x = Math.PI / 1.8;
    ring2.rotation.z = 0.4;
    coreGroup.add(ring2);

    // ── Infrastructure Nodes ─────────────────────────────────
    interface NodeObject {
      info: InfraNode;
      group: THREE.Group;
      sphere: THREE.Mesh;
      spMat: THREE.MeshStandardMaterial;
      basePos: THREE.Vector3;
      haloMesh: THREE.Mesh;
      haloMat: THREE.MeshBasicMaterial;
      connLine: THREE.Line;
      connMat: THREE.LineBasicMaterial;
      pulse: THREE.Mesh;
      pulseMat: THREE.MeshBasicMaterial;
      pulseT: number;
      isHovered: boolean;
    }

    const nodeObjects: NodeObject[] = [];
    const raycasterTargets: THREE.Mesh[] = [];

    INFRA_NODES.forEach((info, i) => {
      const group = new THREE.Group();
      group.position.set(...info.position);

      const spMat = new THREE.MeshStandardMaterial({
        color: info.color,
        metalness: 0.25,
        roughness: 0.45,
        transparent: true,
        opacity: 0.95,
      });
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.38, 28, 28),
        spMat
      );
      sphere.castShadow = true;
      sphere.userData = { nodeIndex: i };
      group.add(sphere);
      raycasterTargets.push(sphere);

      // Halo ring
      const haloMat = new THREE.MeshBasicMaterial({
        color: info.accentColor,
        transparent: true,
        opacity: 0.0,
        side: THREE.DoubleSide,
      });
      const haloMesh = new THREE.Mesh(
        new THREE.TorusGeometry(0.58, 0.025, 8, 40),
        haloMat
      );
      haloMesh.rotation.x = Math.PI / 2;
      group.add(haloMesh);

      scene.add(group);

      // Connection line
      const connMat = new THREE.LineBasicMaterial({
        color: info.color,
        transparent: true,
        opacity: 0.15,
      });
      const connGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(...info.position),
      ]);
      const connLine = new THREE.Line(connGeo, connMat);
      scene.add(connLine);

      // Pulse particle
      const pulseMat = new THREE.MeshBasicMaterial({
        color: info.accentColor,
        transparent: true,
        opacity: 0.8,
      });
      const pulse = new THREE.Mesh(
        new THREE.SphereGeometry(0.055, 8, 8),
        pulseMat
      );
      scene.add(pulse);

      nodeObjects.push({
        info,
        group,
        sphere,
        spMat,
        basePos: new THREE.Vector3(...info.position),
        haloMesh,
        haloMat,
        connLine,
        connMat,
        pulse,
        pulseMat,
        pulseT: i / INFRA_NODES.length,
        isHovered: false,
      });
    });

    // ── Raycaster ─────────────────────────────────────────────
    const raycaster = new THREE.Raycaster();
    const mouse2D = new THREE.Vector2(-10, -10);
    let hoveredIndex = -1;

    // Camera target (for gentle parallax)
    const camTarget = { x: 0, y: 0.5 };
    let isTabVisible = true;

    // ── Pointer events (scoped to container) ─────────────────
    const onPointerMove = (e: PointerEvent) => {
      const rect = mount.getBoundingClientRect();
      mouse2D.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse2D.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      // Gentle parallax on camera
      camTarget.x = mouse2D.x * 0.6;
      camTarget.y = 0.5 + mouse2D.y * 0.4;
    };

    const onPointerDown = (e: PointerEvent) => {
      const rect = mount.getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const py = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      const clickMouse = new THREE.Vector2(px, py);
      raycaster.setFromCamera(clickMouse, camera);
      const hits = raycaster.intersectObjects(raycasterTargets);
      if (hits.length > 0) {
        const idx = hits[0].object.userData.nodeIndex as number;
        clickCallbackRef.current?.(nodeObjects[idx].info);
      }
    };

    const onPointerLeave = () => {
      mouse2D.set(-10, -10);
      if (hoveredIndex !== -1) {
        hoveredIndex = -1;
        hoverCallbackRef.current?.(null);
      }
    };

    mount.addEventListener('pointermove', onPointerMove, { passive: true });
    mount.addEventListener('pointerdown', onPointerDown);
    mount.addEventListener('pointerleave', onPointerLeave);

    // ── Resize ────────────────────────────────────────────────
    const onResize = () => {
      if (!mount) return;
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize, { passive: true });

    // ── Visibility (pause render when hidden) ─────────────────
    const onVisibility = () => { isTabVisible = !document.hidden; };
    document.addEventListener('visibilitychange', onVisibility);

    // ── IntersectionObserver (pause when off-screen) ──────────
    let isVisible = true;
    const observer = new IntersectionObserver(
      ([entry]) => { isVisible = entry.isIntersecting; },
      { threshold: 0.01 }
    );
    observer.observe(mount);

    // ── Animation loop ────────────────────────────────────────
    let raf: number;
    let lastTime = 0;
    const clock = new THREE.Clock();

    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

    const animate = (time: number) => {
      raf = requestAnimationFrame(animate);
      if (!isTabVisible || !isVisible) return;

      // Throttle to ~60fps
      if (time - lastTime < 14) return;
      lastTime = time;

      const t = clock.getElapsedTime();

      // Camera gentle float
      camera.position.x = lerp(camera.position.x, camTarget.x, 0.04);
      camera.position.y = lerp(camera.position.y, camTarget.y, 0.04);
      camera.lookAt(0, 0, 0);

      // Core gentle animation
      coreGroup.rotation.y = t * 0.08;
      coreGroup.rotation.x = Math.sin(t * 0.2) * 0.06;
      outerRing.rotation.z = t * 0.12;
      ring2.rotation.y = -t * 0.09;

      // Subtle core pulse
      const pulse = 0.96 + Math.sin(t * 1.2) * 0.04;
      coreGroup.scale.setScalar(pulse);

      // Read current state from ref (no re-render)
      const curState = stateRef.current;
      const highlightIds = STATE_HIGHLIGHTS[curState];

      // Raycasting for hover
      raycaster.setFromCamera(mouse2D, camera);
      const hits = raycaster.intersectObjects(raycasterTargets);
      const newHoveredIdx = hits.length > 0
        ? (hits[0].object.userData.nodeIndex as number)
        : -1;

      if (newHoveredIdx !== hoveredIndex) {
        hoveredIndex = newHoveredIdx;
        hoverCallbackRef.current?.(
          newHoveredIdx >= 0 ? nodeObjects[newHoveredIdx].info : null
        );
      }

      // Update each node
      nodeObjects.forEach((n, i) => {
        const isHighlighted = highlightIds.length === 0 || highlightIds.includes(n.info.id);
        const isHov = i === hoveredIndex;

        // Float
        const floatY = Math.sin(t * 0.9 + i * 1.1) * 0.10;
        const orbitX = Math.sin(t * 0.06 + i * 1.05) * 0.08;
        n.group.position.set(
          n.basePos.x + orbitX,
          n.basePos.y + floatY,
          n.basePos.z + Math.cos(t * 0.06 + i * 1.05) * 0.06
        );

        // Highlight opacity
        const targetOpacity = isHighlighted ? 0.95 : 0.28;
        n.spMat.opacity = lerp(n.spMat.opacity, targetOpacity, 0.06);

        // Scale on hover
        const targetScale = isHov ? 1.22 : 1.0;
        n.group.scale.setScalar(lerp(n.group.scale.x, targetScale, 0.12));

        // Halo on hover or highlight
        const targetHaloOpacity = isHov ? 0.55 : (isHighlighted ? 0.20 : 0.0);
        n.haloMat.opacity = lerp(n.haloMat.opacity, targetHaloOpacity, 0.10);
        n.haloMesh.rotation.z = t * 0.3;

        // Connection line opacity
        const targetConnOpacity = isHighlighted ? 0.22 : 0.06;
        n.connMat.opacity = lerp(n.connMat.opacity, targetConnOpacity, 0.06);

        // Update connection line endpoint
        const pos = n.connLine.geometry.getAttribute('position') as THREE.BufferAttribute;
        pos.setXYZ(1, n.group.position.x, n.group.position.y, n.group.position.z);
        pos.needsUpdate = true;

        // Pulse (travel from core to node)
        if (isHighlighted) {
          n.pulseT = (n.pulseT + 0.006) % 1;
          n.pulseMat.opacity = lerp(n.pulseMat.opacity, 0.9, 0.06);
        } else {
          n.pulseT = (n.pulseT + 0.002) % 1;
          n.pulseMat.opacity = lerp(n.pulseMat.opacity, 0.0, 0.06);
        }
        n.pulse.position.lerpVectors(
          new THREE.Vector3(0, 0, 0),
          n.group.position,
          n.pulseT
        );
      });

      renderer.render(scene, camera);
    };

    raf = requestAnimationFrame(animate);

    // ── Cleanup ───────────────────────────────────────────────
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      mount.removeEventListener('pointermove', onPointerMove);
      mount.removeEventListener('pointerdown', onPointerDown);
      mount.removeEventListener('pointerleave', onPointerLeave);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);

      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }

      // Dispose
      nodeObjects.forEach(n => {
        n.spMat.dispose();
        n.haloMat.dispose();
        n.connMat.dispose();
        n.pulseMat.dispose();
        n.sphere.geometry.dispose();
        n.haloMesh.geometry.dispose();
        n.connLine.geometry.dispose();
        n.pulse.geometry.dispose();
      });
      coreMat.dispose();
      ringMat.dispose();
      renderer.dispose();
    };
  // Only run once — state updates go through refs
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={mountRef}
      className={className}
      style={{ width: '100%', height: '100%', cursor: 'default' }}
      aria-label="Interactive 3D AWS cloud infrastructure visualization"
      role="img"
    />
  );
};

export { INFRA_NODES };
