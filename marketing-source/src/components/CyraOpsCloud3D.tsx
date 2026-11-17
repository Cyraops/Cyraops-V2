import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { SceneFallback } from './SceneFallback';

export interface InfraNodeInfo {
  id: string;
  name: string;
  category: 'Compute' | 'Storage' | 'Networking' | 'Security' | 'Database';
  summary: string;
  specs: string[];
  color: string;
  pos: [number, number, number];
}

export const INFRA_NODES: InfraNodeInfo[] = [
  {
    id: 'compute',
    name: 'Container & Compute Fleet',
    category: 'Compute',
    summary: 'Autoscaling Kubernetes, ECS & serverless Lambda compute runtimes with automated node balancing.',
    specs: ['Multi-AZ Autoscale', 'Sub-second cold starts', 'Zero-downtime rolling deploys'],
    color: '#38D9FF',
    pos: [2.7, 1.0, 0.8],
  },
  {
    id: 'storage',
    name: 'Encrypted Object & Block Store',
    category: 'Storage',
    summary: 'High-durability object storage, automated tiering, and high-IOPS persistent storage volumes.',
    specs: ['99.999999999% durability', 'AES-256 server-side encryption', 'Automated lifecycle policies'],
    color: '#7AA8FF',
    pos: [-2.6, -0.6, 1.4],
  },
  {
    id: 'networking',
    name: 'Global Mesh & Edge Gateway',
    category: 'Networking',
    summary: 'Intelligent traffic distribution, Route 53 DNS, CloudFront CDN, and redundant Transit Gateways.',
    specs: ['Anycast routing', 'Sub-15ms edge latency', 'Automated DDoS mitigation'],
    color: '#38D9FF',
    pos: [-2.8, 1.5, -0.8],
  },
  {
    id: 'security',
    name: 'Zero-Trust IAM & Vault',
    category: 'Security',
    summary: 'Continuous compliance policy auditing, least-privilege IAM roles, and secret rotation pipelines.',
    specs: ['Automated key rotation', 'SOC2 / ISO27001 posture audits', 'Strict isolation enclaves'],
    color: '#10B981',
    pos: [0.0, 2.5, 0.2],
  },
  {
    id: 'database',
    name: 'Clustered Relational Datastores',
    category: 'Database',
    summary: 'Multi-Region Aurora PostgreSQL & managed Redis caches with automated failover and read replicas.',
    specs: ['Sub-millisecond read latency', 'Continuous PITR point-in-time recovery', 'Automated horizontal sharding'],
    color: '#60A5FA',
    pos: [2.5, -1.1, -1.2],
  },
];

interface CyraOpsCloud3DProps {
  onSelectNode?: (node: InfraNodeInfo) => void;
  selectedNodeId?: string | null;
}

interface TooltipState {
  node: InfraNodeInfo;
  x: number;
  y: number;
}

export const CyraOpsCloud3D: React.FC<CyraOpsCloud3DProps> = ({
  onSelectNode,
  selectedNodeId,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const [hasWebGL, setHasWebGL] = useState<boolean | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [isHoveringInteractive, setIsHoveringInteractive] = useState(false);

  // References for animation & interaction
  const mouseRef = useRef(new THREE.Vector2(0, 0));
  const targetCamPosRef = useRef(new THREE.Vector3(0, 0.8, 8.8));
  const currentCamPosRef = useRef(new THREE.Vector3(0, 0.8, 8.8));
  const sceneReadyRef = useRef(false);
  const hoveredNodeIdRef = useRef<string | null>(null);

  // Check WebGL availability once
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
      const node = INFRA_NODES.find(n => n.id === nodeId);
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

    // Check prefers-reduced-motion
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    sceneReadyRef.current = true;
    let isDisposed = false;
    let isTabVisible = !document.hidden;

    // ── 1. RENDERER & SCENE SETUP ──────────────────────────────────────────
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
    renderer.toneMappingExposure = 1.25;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    // Subtle atmospheric distance fog
    scene.fog = new THREE.FogExp2(0x050912, 0.04);

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    camera.position.set(0, 0.8, 8.8);
    camera.lookAt(0, 0, 0);

    // ── 2. LIGHTING ────────────────────────────────────────────────────────
    // Ambient light with midnight tone
    const ambientLight = new THREE.AmbientLight(0x0a1628, 2.4);
    scene.add(ambientLight);

    // Primary cyan key light from upper-left
    const keyLight = new THREE.DirectionalLight(0x38d9ff, 3.2);
    keyLight.position.set(-6, 8, 7);
    scene.add(keyLight);

    // Ice-blue rim light from right rear
    const rimLight = new THREE.DirectionalLight(0x7aa8ff, 2.0);
    rimLight.position.set(7, -4, -6);
    scene.add(rimLight);

    // Internal volumetric cloud glow (Point light inside central core)
    const cloudGlowLight = new THREE.PointLight(0x38d9ff, 3.5, 12, 1.6);
    cloudGlowLight.position.set(0, 0.4, 0);
    scene.add(cloudGlowLight);

    // ── 3. SCULPTURAL TRANSLUCENT CLOUD VOLUME ─────────────────────────────
    const cloudGroup = new THREE.Group();
    scene.add(cloudGroup);

    // Cloud material: physically based translucent glass-like material
    const cloudMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x142848,
      emissive: 0x0c2240,
      emissiveIntensity: 0.45,
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

    // ── 4. ARCHITECTURAL SERVER RACKS (WITHIN & UNDER THE CLOUD) ───────────
    const rackGroup = new THREE.Group();
    scene.add(rackGroup);

    const rackChassisMat = new THREE.MeshStandardMaterial({
      color: 0x0b1322,
      roughness: 0.45,
      metalness: 0.85,
    });

    const rackSlotMat = new THREE.MeshStandardMaterial({
      color: 0x111c30,
      roughness: 0.6,
      metalness: 0.5,
    });

    const ledActiveMat = new THREE.MeshBasicMaterial({ color: 0x38d9ff });
    const ledGreenMat = new THREE.MeshBasicMaterial({ color: 0x10b981 });

    // Build 3 architectural server enclosures
    const rackConfigs = [
      { x: -0.85, y: -0.4, z: 0.2, w: 0.65, h: 1.1, d: 0.8 },
      { x: 0.0, y: -0.45, z: 0.35, w: 0.75, h: 1.2, d: 0.9 },
      { x: 0.85, y: -0.4, z: 0.15, w: 0.65, h: 1.05, d: 0.8 },
    ];

    rackConfigs.forEach(rc => {
      // Main rack frame
      const frameGeo = new THREE.BoxGeometry(rc.w, rc.h, rc.d);
      const frame = new THREE.Mesh(frameGeo, rackChassisMat);
      frame.position.set(rc.x, rc.y, rc.z);
      rackGroup.add(frame);

      // Server blades inside chassis
      const bladeCount = 5;
      const bladeH = (rc.h * 0.8) / bladeCount;
      for (let b = 0; b < bladeCount; b++) {
        const bladeY = rc.y - rc.h * 0.35 + b * (bladeH + 0.02);
        const bladeGeo = new THREE.BoxGeometry(rc.w * 0.88, bladeH * 0.75, rc.d * 0.92);
        const blade = new THREE.Mesh(bladeGeo, rackSlotMat);
        blade.position.set(rc.x, bladeY, rc.z + 0.02);
        rackGroup.add(blade);

        // Status LED dots on front panel
        const ledGeo = new THREE.SphereGeometry(0.018, 8, 8);
        const led1 = new THREE.Mesh(ledGeo, b % 2 === 0 ? ledActiveMat : ledGreenMat);
        led1.position.set(rc.x - rc.w * 0.34, bladeY, rc.z + rc.d * 0.46);
        rackGroup.add(led1);

        const led2 = new THREE.Mesh(ledGeo, ledActiveMat);
        led2.position.set(rc.x - rc.w * 0.26, bladeY, rc.z + rc.d * 0.46);
        rackGroup.add(led2);
      }
    });

    // ── 5. CURVED DIGITAL HORIZON & PLANETARY SURFACE ──────────────────────
    const horizonGroup = new THREE.Group();
    scene.add(horizonGroup);

    // Soft digital curved planetary horizon disc
    const horizonGeo = new THREE.CircleGeometry(7.5, 48);
    const horizonMat = new THREE.MeshBasicMaterial({
      color: 0x060f1e,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.75,
    });
    const horizonMesh = new THREE.Mesh(horizonGeo, horizonMat);
    horizonMesh.rotation.x = -Math.PI / 2 + 0.14;
    horizonMesh.position.set(0, -2.6, -1.0);
    horizonGroup.add(horizonMesh);

    // Concentric orbital grid rings on planetary plane
    for (let r = 2.5; r <= 7.0; r += 1.5) {
      const ringGeo = new THREE.RingGeometry(r, r + 0.02, 64);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x173154,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.4,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2 + 0.14;
      ring.position.set(0, -2.59, -1.0);
      horizonGroup.add(ring);
    }

    // ── 6. INFRASTRUCTURE NODES & ORBITAL BEZIER CURVES ────────────────────
    const nodeMeshes: { mesh: THREE.Mesh; hitBox: THREE.Mesh; info: InfraNodeInfo }[] = [];
    const nodeGroup = new THREE.Group();
    scene.add(nodeGroup);

    INFRA_NODES.forEach(node => {
      // Node enclosure: small translucent workload cube
      const nodeGeo = new THREE.BoxGeometry(0.38, 0.38, 0.38);
      const nodeMat = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(node.color),
        emissive: new THREE.Color(node.color),
        emissiveIntensity: 0.6,
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

      // Invisible hitBox for dependable raycasting
      const hitBoxGeo = new THREE.SphereGeometry(0.5, 12, 12);
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

    // ── 7. DATA FLOW CURVES & PULSES ───────────────────────────────────────
    const curveList: THREE.QuadraticBezierCurve3[] = [];
    const curveMat = new THREE.LineBasicMaterial({
      color: 0x38d9ff,
      transparent: true,
      opacity: 0.25,
    });

    // Define pairwise infrastructure connection curves with gentle arches
    const connections: [number, number][] = [
      [0, 1], // compute <-> storage
      [0, 2], // compute <-> networking
      [0, 3], // compute <-> security
      [1, 4], // storage <-> database
      [2, 3], // networking <-> security
      [2, 0], // networking <-> compute
    ];

    connections.forEach(([fromIdx, toIdx]) => {
      const from = new THREE.Vector3(...INFRA_NODES[fromIdx].pos);
      const to = new THREE.Vector3(...INFRA_NODES[toIdx].pos);
      const mid = from.clone().lerp(to, 0.5);
      mid.y += 0.5; // slight arch

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

      // Bounded camera parallax target
      mouseRef.current.set(x, y);
      targetCamPosRef.current.x = x * 0.65;
      targetCamPosRef.current.y = 0.8 + y * 0.45;
    };

    const onPointerLeave = () => {
      mouseNDC.set(-10, -10);
      targetCamPosRef.current.set(0, 0.8, 8.8);
      hoveredNodeIdRef.current = null;
      setTooltip(null);
      setIsHoveringInteractive(false);
    };

    const onPointerClick = (e: MouseEvent) => {
      if (!hoveredNodeIdRef.current) return;
      handleNodeClick(hoveredNodeIdRef.current);
    };

    mount.addEventListener('mousemove', onPointerMove, { passive: true });
    mount.addEventListener('mouseleave', onPointerLeave);
    mount.addEventListener('click', onPointerClick);

    // Window resize handler
    const onResize = () => {
      if (!mount) return;
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    // Visibility change handler (pause when tab hidden)
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
      // Cap at ~60fps
      if (time - lastFrameTime < 14) return;
      lastFrameTime = time;

      const elapsed = (time - startTime) * 0.001;

      // Gentle cloud breathing and secondary motion (disabled if reduced motion)
      if (!prefersReducedMotion) {
        cloudGroup.rotation.y = Math.sin(elapsed * 0.25) * 0.08;
        cloudGroup.position.y = Math.sin(elapsed * 0.6) * 0.06;

        // Subtle pulsing on translucent cloud volumes
        cloudMeshes.forEach((mesh, idx) => {
          const s = 1 + Math.sin(elapsed * 0.8 + idx) * 0.025;
          mesh.scale.set(
            cloudClusterDefs[idx].scale[0] * s,
            cloudClusterDefs[idx].scale[1] * s,
            cloudClusterDefs[idx].scale[2] * s,
          );
        });

        // Rotate individual node cubes gently
        nodeMeshes.forEach(({ mesh }, idx) => {
          mesh.rotation.y = elapsed * 0.6 + idx;
          mesh.rotation.x = Math.sin(elapsed * 0.4 + idx) * 0.2;
        });

        // Parallax camera lerp
        currentCamPosRef.current.lerp(targetCamPosRef.current, 0.04);
        camera.position.x = currentCamPosRef.current.x;
        camera.position.y = currentCamPosRef.current.y;
        camera.lookAt(0, 0, 0);

        // Animate cyan data pulses along curves
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

      // ── Raycasting on node hitBoxes ──────────────────────────────────────
      raycaster.setFromCamera(mouseNDC, camera);
      const hitBoxes = nodeMeshes.map(n => n.hitBox);
      const intersects = raycaster.intersectObjects(hitBoxes);

      if (intersects.length > 0) {
        const hitId = intersects[0].object.userData.nodeId as string;
        const targetNode = nodeMeshes.find(n => n.info.id === hitId);

        if (targetNode) {
          hoveredNodeIdRef.current = hitId;
          setIsHoveringInteractive(true);

          // Project 3D coordinate to screen coordinates for floating label
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
          setIsHoveringInteractive(false);
        }
      }

      renderer.render(scene, camera);
    };

    rafId = requestAnimationFrame(animate);

    // ── 10. CLEANUP ────────────────────────────────────────────────────────
    return () => {
      isDisposed = true;
      cancelAnimationFrame(rafId);

      mount.removeEventListener('mousemove', onPointerMove);
      mount.removeEventListener('mouseleave', onPointerLeave);
      mount.removeEventListener('click', onPointerClick);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);

      // Dispose Three.js scene & renderer
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
        cursor: isHoveringInteractive ? 'pointer' : 'default',
        userSelect: 'none',
      }}
      role="region"
      aria-label="Interactive 3D Cloud Infrastructure Scene"
    >
      {/* Three.js Canvas Container */}
      <div
        ref={mountRef}
        style={{
          width: '100%',
          height: '100%',
          position: 'absolute',
          inset: 0,
        }}
      />

      {/* Floating 3D Node Label Tooltip (Projected via Three.js screen coordinates) */}
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
              background: 'rgba(16, 27, 43, 0.92)',
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
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                marginBottom: '2px',
              }}
            >
              {tooltip.node.category} &middot; ACTIVE
            </div>
            <div
              style={{
                fontSize: '0.82rem',
                fontWeight: 600,
                color: '#F4F7FB',
              }}
            >
              {tooltip.node.name}
            </div>
            <div
              style={{
                fontSize: '0.68rem',
                color: 'rgba(244, 247, 251, 0.65)',
                marginTop: '3px',
              }}
            >
              Click node to inspect telemetry
            </div>
          </div>
          {/* Tooltip downward pointer arrow */}
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

      {/* Subtle bottom helper tag */}
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
          background: 'rgba(10, 18, 32, 0.7)',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(150, 190, 220, 0.16)',
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
        <span>Interactive 3D Topology &middot; Orbit &amp; Click Nodes</span>
      </div>
    </div>
  );
};
