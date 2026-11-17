import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { SceneFallback } from './SceneFallback';

export interface HeroInfraNode {
  id: string;
  name: string;
  detail: string;
  status: string;
  color: string;
  pos: [number, number, number];
}

export const HERO_NODES: HeroInfraNode[] = [
  {
    id: 'compute',
    name: 'COMPUTE',
    detail: 'EC2, ECS & Lambda Fleet Health',
    status: 'Optimal',
    color: '#38D9FF',
    pos: [2.8, 1.2, 0.6],
  },
  {
    id: 'storage',
    name: 'STORAGE',
    detail: 'S3 Buckets, EBS Lifecycle & IOPS',
    status: 'Healthy',
    color: '#7AA8FF',
    pos: [-2.6, -0.6, 1.3],
  },
  {
    id: 'monitoring',
    name: 'MONITORING',
    detail: 'CloudWatch Alarms & Telemetry',
    status: 'Active',
    color: '#10B981',
    pos: [-2.3, 1.9, -0.5],
  },
  {
    id: 'backups',
    name: 'BACKUPS',
    detail: 'Automated Snapshots & Recovery Validation',
    status: 'Verified',
    color: '#38D9FF',
    pos: [2.5, -1.2, -1.1],
  },
  {
    id: 'cost',
    name: 'COST',
    detail: 'Spend Attribution & Idle Elimination',
    status: 'Audited',
    color: '#F59E0B',
    pos: [-0.2, -2.1, 1.0],
  },
  {
    id: 'reliability',
    name: 'RELIABILITY',
    detail: 'Multi-AZ Availability & Circuit Breakers',
    status: 'Protected',
    color: '#60A5FA',
    pos: [0.1, 2.5, 0.3],
  },
];

interface HeroInfrastructure3DProps {
  onSelectNode?: (node: HeroInfraNode) => void;
}

interface TooltipData {
  node: HeroInfraNode;
  x: number;
  y: number;
}

export const HeroInfrastructure3D: React.FC<HeroInfrastructure3DProps> = ({ onSelectNode }) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const [hasWebGL, setHasWebGL] = useState<boolean | null>(null);
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [isHovered, setIsHovered] = useState(false);

  const mouseRef = useRef(new THREE.Vector2(0, 0));
  const targetCamPosRef = useRef(new THREE.Vector3(0, 0.8, 8.8));
  const currentCamPosRef = useRef(new THREE.Vector3(0, 0.8, 8.8));
  const sceneReadyRef = useRef(false);
  const hoveredNodeIdRef = useRef<string | null>(null);

  useEffect(() => {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      setHasWebGL(Boolean(gl));
    } catch {
      setHasWebGL(false);
    }
  }, []);

  const handleNodeClick = useCallback(
    (nodeId: string) => {
      const node = HERO_NODES.find(n => n.id === nodeId);
      if (node && onSelectNode) {
        onSelectNode(node);
      }
    },
    [onSelectNode],
  );

  useEffect(() => {
    if (hasWebGL === false) return;
    const mount = mountRef.current;
    if (!mount || sceneReadyRef.current) return;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    sceneReadyRef.current = true;
    let isDisposed = false;
    let isTabVisible = !document.hidden;

    // ── 1. RENDERER & SCENE ────────────────────────────────────────────────
    const width = mount.clientWidth || 600;
    const height = mount.clientHeight || 560;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.22;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x060a12, 0.04);

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    camera.position.set(0, 0.8, 8.8);
    camera.lookAt(0, 0, 0);

    // ── 2. LIGHTING ────────────────────────────────────────────────────────
    const ambientLight = new THREE.AmbientLight(0x0c1a2e, 2.4);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0x38d9ff, 3.2);
    keyLight.position.set(-6, 8, 7);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x7aa8ff, 1.8);
    rimLight.position.set(7, -4, -6);
    scene.add(rimLight);

    // Volumetric inner core light
    const innerLight = new THREE.PointLight(0x38d9ff, 3.6, 12, 1.6);
    innerLight.position.set(0, 0.3, 0);
    scene.add(innerLight);

    // ── 3. CENTRAL SCULPTURAL CLOUD STRUCTURE ──────────────────────────────
    const cloudGroup = new THREE.Group();
    scene.add(cloudGroup);

    const cloudMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x142848,
      emissive: 0x0c2240,
      emissiveIntensity: 0.42,
      roughness: 0.22,
      metalness: 0.1,
      transmission: 0.72,
      ior: 1.25,
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
    });

    const cloudClusterDefs = [
      { pos: [0, 0.3, 0], scale: [2.1, 1.15, 1.7] },
      { pos: [-1.2, 0.1, -0.3], scale: [1.6, 0.95, 1.4] },
      { pos: [1.3, 0.2, -0.2], scale: [1.65, 1.0, 1.45] },
      { pos: [0.3, 0.8, -0.5], scale: [1.5, 0.85, 1.3] },
      { pos: [-0.6, -0.2, 0.7], scale: [1.4, 0.8, 1.25] },
      { pos: [0.8, -0.3, 0.6], scale: [1.35, 0.75, 1.2] },
    ];

    const cloudMeshes: THREE.Mesh[] = [];
    cloudClusterDefs.forEach(({ pos, scale }) => {
      const geo = new THREE.SphereGeometry(1, 32, 28);
      const mesh = new THREE.Mesh(geo, cloudMaterial);
      mesh.position.set(pos[0], pos[1], pos[2]);
      mesh.scale.set(scale[0], scale[1], scale[2]);
      cloudGroup.add(mesh);
      cloudMeshes.push(mesh);
    });

    // ── 4. ARCHITECTURAL SERVER MODULES NESTLED WITHIN ────────────────────
    const rackGroup = new THREE.Group();
    scene.add(rackGroup);

    const chassisMat = new THREE.MeshStandardMaterial({
      color: 0x091120,
      roughness: 0.45,
      metalness: 0.85,
    });

    const bladeMat = new THREE.MeshStandardMaterial({
      color: 0x111c30,
      roughness: 0.6,
      metalness: 0.5,
    });

    const ledCyanMat = new THREE.MeshBasicMaterial({ color: 0x38d9ff });
    const ledGreenMat = new THREE.MeshBasicMaterial({ color: 0x10b981 });

    const rackPositions = [
      { x: -0.85, y: -0.4, z: 0.2, w: 0.65, h: 1.1, d: 0.8 },
      { x: 0.0, y: -0.45, z: 0.35, w: 0.75, h: 1.2, d: 0.9 },
      { x: 0.85, y: -0.4, z: 0.15, w: 0.65, h: 1.05, d: 0.8 },
    ];

    rackPositions.forEach(rc => {
      const frameGeo = new THREE.BoxGeometry(rc.w, rc.h, rc.d);
      const frame = new THREE.Mesh(frameGeo, chassisMat);
      frame.position.set(rc.x, rc.y, rc.z);
      rackGroup.add(frame);

      const bladeCount = 5;
      const bladeH = (rc.h * 0.8) / bladeCount;
      for (let b = 0; b < bladeCount; b++) {
        const bladeY = rc.y - rc.h * 0.35 + b * (bladeH + 0.02);
        const bladeGeo = new THREE.BoxGeometry(rc.w * 0.88, bladeH * 0.75, rc.d * 0.92);
        const blade = new THREE.Mesh(bladeGeo, bladeMat);
        blade.position.set(rc.x, bladeY, rc.z + 0.02);
        rackGroup.add(blade);

        // Indicator LEDs
        const ledGeo = new THREE.SphereGeometry(0.018, 8, 8);
        const led1 = new THREE.Mesh(ledGeo, b % 2 === 0 ? ledCyanMat : ledGreenMat);
        led1.position.set(rc.x - rc.w * 0.34, bladeY, rc.z + rc.d * 0.46);
        rackGroup.add(led1);

        const led2 = new THREE.Mesh(ledGeo, ledCyanMat);
        led2.position.set(rc.x - rc.w * 0.26, bladeY, rc.z + rc.d * 0.46);
        rackGroup.add(led2);
      }
    });

    // ── 5. CURVED DIGITAL HORIZON ─────────────────────────────────────────
    const horizonGroup = new THREE.Group();
    scene.add(horizonGroup);

    const horizonGeo = new THREE.CircleGeometry(7.5, 48);
    const horizonMat = new THREE.MeshBasicMaterial({
      color: 0x071120,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.7,
    });
    const horizonMesh = new THREE.Mesh(horizonGeo, horizonMat);
    horizonMesh.rotation.x = -Math.PI / 2 + 0.14;
    horizonMesh.position.set(0, -2.6, -1.0);
    horizonGroup.add(horizonMesh);

    // Grid rings
    for (let r = 2.5; r <= 7.0; r += 1.5) {
      const ringGeo = new THREE.RingGeometry(r, r + 0.02, 64);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x142845,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.4,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2 + 0.14;
      ring.position.set(0, -2.59, -1.0);
      horizonGroup.add(ring);
    }

    // ── 6. 6 INFRASTRUCTURE NODES (COMPUTE, STORAGE, MONITORING, BACKUPS, COST, RELIABILITY) ──
    const nodeMeshes: { mesh: THREE.Mesh; hitBox: THREE.Mesh; info: HeroInfraNode }[] = [];
    const nodeGroup = new THREE.Group();
    scene.add(nodeGroup);

    HERO_NODES.forEach(node => {
      const nodeGeo = new THREE.BoxGeometry(0.38, 0.38, 0.38);
      const nodeMat = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(node.color),
        emissive: new THREE.Color(node.color),
        emissiveIntensity: 0.65,
        roughness: 0.2,
        metalness: 0.3,
        transmission: 0.5,
        transparent: true,
        opacity: 0.85,
      });
      const mesh = new THREE.Mesh(nodeGeo, nodeMat);
      mesh.position.set(...node.pos);
      nodeGroup.add(mesh);

      // Inner glowing core
      const coreGeo = new THREE.OctahedronGeometry(0.14, 0);
      const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const core = new THREE.Mesh(coreGeo, coreMat);
      mesh.add(core);

      // Wireframe cage
      const cageGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(0.44, 0.44, 0.44));
      const cageMat = new THREE.LineBasicMaterial({
        color: new THREE.Color(node.color),
        transparent: true,
        opacity: 0.5,
      });
      const cage = new THREE.LineSegments(cageGeo, cageMat);
      mesh.add(cage);

      // Invisible hitBox for raycasting
      const hitBoxGeo = new THREE.SphereGeometry(0.55, 12, 12);
      const hitBoxMat = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const hitBox = new THREE.Mesh(hitBoxGeo, hitBoxMat);
      hitBox.position.set(...node.pos);
      hitBox.userData = { nodeId: node.id };
      scene.add(hitBox);

      nodeMeshes.push({ mesh, hitBox, info: node });
    });

    // ── 7. DATA LINES CONNECTING NODES TO CORE ────────────────────────────
    const curveList: THREE.QuadraticBezierCurve3[] = [];
    const curveMat = new THREE.LineBasicMaterial({
      color: 0x38d9ff,
      transparent: true,
      opacity: 0.25,
    });

    HERO_NODES.forEach(node => {
      const from = new THREE.Vector3(...node.pos);
      const to = new THREE.Vector3(0, 0.2, 0); // connect to central core
      const mid = from.clone().lerp(to, 0.5);
      mid.y += 0.4;

      const curve = new THREE.QuadraticBezierCurve3(from, mid, to);
      const pts = curve.getPoints(36);
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const line = new THREE.Line(geo, curveMat);
      scene.add(line);
      curveList.push(curve);
    });

    // Cyan glowing data pulses travelling along curves
    const pulseCount = curveList.length * 2;
    const pulseGeo = new THREE.SphereGeometry(0.045, 8, 8);
    const pulseMat = new THREE.MeshBasicMaterial({ color: 0x38d9ff });
    const pulseMesh = new THREE.InstancedMesh(pulseGeo, pulseMat, pulseCount);
    pulseMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(pulseMesh);

    const dummy = new THREE.Object3D();
    const pulseProgress = Array.from({ length: pulseCount }, (_, i) => (i * 0.5) % 1);

    // ── 8. RAYCASTER & INTERACTION ─────────────────────────────────────────
    const raycaster = new THREE.Raycaster();
    const mouseNDC = new THREE.Vector2(-10, -10);

    const onPointerMove = (e: MouseEvent) => {
      const rect = mount.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      mouseNDC.set(x, y);

      mouseRef.current.set(x, y);
      targetCamPosRef.current.x = x * 0.65;
      targetCamPosRef.current.y = 0.8 + y * 0.45;

      // Subtle light direction shift
      keyLight.position.x = -6 + x * 2.0;
      keyLight.position.y = 8 + y * 2.0;
    };

    const onPointerLeave = () => {
      mouseNDC.set(-10, -10);
      targetCamPosRef.current.set(0, 0.8, 8.8);
      hoveredNodeIdRef.current = null;
      setTooltip(null);
      setIsHovered(false);
    };

    const onPointerClick = () => {
      if (!hoveredNodeIdRef.current) return;
      handleNodeClick(hoveredNodeIdRef.current);
    };

    mount.addEventListener('mousemove', onPointerMove, { passive: true });
    mount.addEventListener('mouseleave', onPointerLeave);
    mount.addEventListener('click', onPointerClick);

    const onResize = () => {
      if (!mount) return;
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    const onVisibility = () => {
      isTabVisible = !document.hidden;
    };
    document.addEventListener('visibilitychange', onVisibility);

    // ── 9. ANIMATION LOOP ──────────────────────────────────────────────────
    let rafId = 0;
    const startTime = performance.now();
    let lastFrameTime = 0;

    const animate = (time: number) => {
      if (isDisposed) return;
      rafId = requestAnimationFrame(animate);

      if (!isTabVisible) return;
      if (time - lastFrameTime < 14) return;
      lastFrameTime = time;

      const elapsed = (time - startTime) * 0.001;

      if (!prefersReducedMotion) {
        cloudGroup.rotation.y = Math.sin(elapsed * 0.25) * 0.08;
        cloudGroup.position.y = Math.sin(elapsed * 0.6) * 0.06;

        cloudMeshes.forEach((mesh, idx) => {
          const s = 1 + Math.sin(elapsed * 0.8 + idx) * 0.025;
          mesh.scale.set(
            cloudClusterDefs[idx].scale[0] * s,
            cloudClusterDefs[idx].scale[1] * s,
            cloudClusterDefs[idx].scale[2] * s,
          );
        });

        nodeMeshes.forEach(({ mesh }, idx) => {
          mesh.rotation.y = elapsed * 0.6 + idx;
          mesh.rotation.x = Math.sin(elapsed * 0.4 + idx) * 0.2;
        });

        currentCamPosRef.current.lerp(targetCamPosRef.current, 0.04);
        camera.position.x = currentCamPosRef.current.x;
        camera.position.y = currentCamPosRef.current.y;
        camera.lookAt(0, 0, 0);

        for (let i = 0; i < pulseCount; i++) {
          const curveIdx = Math.floor(i / 2);
          const curve = curveList[curveIdx];
          pulseProgress[i] = (pulseProgress[i] + 0.004) % 1;
          const pt = curve.getPoint(pulseProgress[i]);
          dummy.position.copy(pt);
          dummy.scale.setScalar(1);
          dummy.updateMatrix();
          pulseMesh.setMatrixAt(i, dummy.matrix);
        }
        pulseMesh.instanceMatrix.needsUpdate = true;
      }

      // Raycasting
      raycaster.setFromCamera(mouseNDC, camera);
      const hitBoxes = nodeMeshes.map(n => n.hitBox);
      const intersects = raycaster.intersectObjects(hitBoxes);

      if (intersects.length > 0) {
        const hitId = intersects[0].object.userData.nodeId as string;
        const targetNode = nodeMeshes.find(n => n.info.id === hitId);

        if (targetNode) {
          hoveredNodeIdRef.current = hitId;
          setIsHovered(true);

          const worldPos = new THREE.Vector3(...targetNode.info.pos);
          worldPos.y += 0.35;
          const projected = worldPos.project(camera);

          const screenX = (projected.x * 0.5 + 0.5) * mount.clientWidth;
          const screenY = (-projected.y * 0.5 + 0.5) * mount.clientHeight;

          setTooltip({
            node: targetNode.info,
            x: screenX,
            y: screenY,
          });
        }
      } else {
        if (hoveredNodeIdRef.current) {
          hoveredNodeIdRef.current = null;
          setTooltip(null);
          setIsHovered(false);
        }
      }

      renderer.render(scene, camera);
    };

    rafId = requestAnimationFrame(animate);

    // ── 10. DISPOSAL ───────────────────────────────────────────────────────
    return () => {
      isDisposed = true;
      cancelAnimationFrame(rafId);

      mount.removeEventListener('mousemove', onPointerMove);
      mount.removeEventListener('mouseleave', onPointerLeave);
      mount.removeEventListener('click', onPointerClick);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);

      scene.clear();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
      sceneReadyRef.current = false;
    };
  }, [hasWebGL, handleNodeClick]);

  if (hasWebGL === false) {
    return <SceneFallback onSelectNode={handleNodeClick} />;
  }

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: '460px',
        cursor: isHovered ? 'pointer' : 'default',
        userSelect: 'none',
      }}
      role="region"
      aria-label="Interactive 3D Cloud Infrastructure Environment"
    >
      <div
        ref={mountRef}
        style={{
          width: '100%',
          height: '100%',
          position: 'absolute',
          inset: 0,
        }}
      />

      {tooltip && (
        <div
          style={{
            position: 'absolute',
            left: `${tooltip.x}px`,
            top: `${tooltip.y}px`,
            transform: 'translate(-50%, -120%)',
            pointerEvents: 'none',
            zIndex: 10,
            animation: 'float-subtle 3s ease-in-out infinite',
          }}
        >
          <div
            style={{
              padding: '8px 14px',
              borderRadius: '8px',
              background: 'rgba(11, 18, 32, 0.94)',
              backdropFilter: 'blur(10px)',
              WebkitBackdropFilter: 'blur(10px)',
              border: `1px solid ${tooltip.node.color}`,
              boxShadow: `0 8px 24px rgba(0, 0, 0, 0.6), 0 0 16px ${tooltip.node.color}40`,
              whiteSpace: 'nowrap',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.68rem',
                fontWeight: 700,
                color: tooltip.node.color,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                marginBottom: '2px',
              }}
            >
              {tooltip.node.name} &middot; {tooltip.node.status}
            </div>
            <div
              style={{
                fontSize: '0.82rem',
                fontWeight: 600,
                color: '#F8FAFC',
              }}
            >
              {tooltip.node.detail}
            </div>
            <div
              style={{
                fontSize: '0.68rem',
                color: 'rgba(248, 250, 252, 0.6)',
                marginTop: '3px',
              }}
            >
              Click node to inspect operational layer
            </div>
          </div>
          <div
            style={{
              width: 0,
              height: 0,
              borderLeft: '5px solid transparent',
              borderRight: '5px solid transparent',
              borderTop: `6px solid ${tooltip.node.color}`,
              margin: '0 auto',
            }}
          />
        </div>
      )}

      {/* Helper telemetry tag */}
      <div
        style={{
          position: 'absolute',
          bottom: '14px',
          right: '16px',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          padding: '6px 12px',
          borderRadius: '100px',
          background: 'rgba(11, 18, 32, 0.75)',
          backdropFilter: 'blur(8px)',
          border: '1px solid var(--border-subtle)',
          fontSize: '0.72rem',
          color: 'var(--text-muted)',
          pointerEvents: 'none',
        }}
      >
        <span
          style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: 'var(--accent-cyan)',
            boxShadow: '0 0 6px var(--accent-cyan)',
          }}
        />
        <span>Interactive 3D Subsystems &middot; Orbit &amp; Click Nodes</span>
      </div>
    </div>
  );
};
