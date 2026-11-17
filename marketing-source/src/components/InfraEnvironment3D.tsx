import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';

// ─── SECTION STATE ────────────────────────────────────────────────────────────
export type SectionId =
  | 'hero' | 'problem' | 'services' | 'health-check'
  | 'optimize' | 'managed-care' | 'how-we-work' | 'why-us' | 'faq' | 'contact';

// ─── INFRASTRUCTURE TOPOLOGY ──────────────────────────────────────────────────
//
//              MONITORING (elevated, top)
//                    │
//  TRAFFIC →  LOAD BALANCER →  APPLICATION  →  COMPUTE
//                                    │               │
//                                DATABASE         STORAGE
//                                    │
//                                 BACKUPS
//
interface InfraNodeDef {
  id: string;
  label: string;
  sublabel: string;
  pos: [number, number, number];
  color: number;     // top indicator color
  w: number; h: number; d: number; // rack dimensions
  stacks: number;    // number of server slabs to stack
}

const NODES: InfraNodeDef[] = [
  {
    id: 'traffic',
    label: 'TRAFFIC',
    sublabel: 'Incoming user requests',
    pos: [-9.5, 0, 0.5],
    color: 0x64748b, w: 0.7, h: 0.22, d: 0.55, stacks: 2,
  },
  {
    id: 'loadbalancer',
    label: 'LOAD BALANCER',
    sublabel: 'Application Load Balancer / Route 53',
    pos: [-6.0, 0, 0],
    color: 0x2563eb, w: 1.4, h: 0.22, d: 0.85, stacks: 2,
  },
  {
    id: 'app',
    label: 'APPLICATION',
    sublabel: 'EC2 / ECS application services',
    pos: [-2.0, 0, 0],
    color: 0x1e40af, w: 1.6, h: 0.22, d: 1.0, stacks: 3,
  },
  {
    id: 'compute',
    label: 'COMPUTE',
    sublabel: 'EC2 / Lambda compute fleet',
    pos: [2.2, -0.3, -2.5],
    color: 0x3b82f6, w: 1.5, h: 0.22, d: 0.95, stacks: 3,
  },
  {
    id: 'database',
    label: 'DATABASE',
    sublabel: 'RDS / Aurora clusters',
    pos: [2.2, -0.3, 2.5],
    color: 0x1d4ed8, w: 1.3, h: 0.22, d: 0.9, stacks: 2,
  },
  {
    id: 'storage',
    label: 'STORAGE',
    sublabel: 'S3 / EBS storage efficiency',
    pos: [5.5, -1.2, -2.0],
    color: 0x0891b2, w: 1.5, h: 0.20, d: 1.0, stacks: 2,
  },
  {
    id: 'backups',
    label: 'BACKUPS',
    sublabel: 'AWS Backup & recovery readiness',
    pos: [5.5, -1.2, 2.0],
    color: 0x047857, w: 1.1, h: 0.20, d: 0.75, stacks: 2,
  },
  {
    id: 'monitoring',
    label: 'MONITORING',
    sublabel: 'CloudWatch visibility & alerting',
    pos: [-2.0, 4.5, -1.5],
    color: 0x059669, w: 1.2, h: 0.22, d: 0.8, stacks: 2,
  },
];

// Edges: [from, to]
const EDGES: [string, string][] = [
  ['traffic',     'loadbalancer'],
  ['loadbalancer','app'],
  ['app',         'compute'],
  ['app',         'database'],
  ['compute',     'storage'],
  ['database',    'backups'],
  ['monitoring',  'app'],
  ['monitoring',  'compute'],
  ['monitoring',  'database'],
  ['storage',     'backups'],
];

// ─── SECTION CAMERA CONFIGS ───────────────────────────────────────────────────
interface CamConfig {
  pos:    [number, number, number];
  target: [number, number, number];
  // per-node overrides: id → emissiveIntensity
  highlights?: string[];
  dimmed?:     string[];
}

const SECTION_CAMS: Record<string, CamConfig> = {
  hero: {
    pos:    [-2, 9, 22],
    target: [0, 0, 0],
  },
  problem: {
    pos:    [-5, 7, 18],
    target: [-2, -1, 0],
    dimmed: ['monitoring', 'backups'],
  },
  services: {
    pos:    [0, 8, 19],
    target: [1, 0, 0],
    highlights: ['loadbalancer', 'app', 'compute'],
  },
  'health-check': {
    pos:    [0, 16, 20],
    target: [0, -1, 0],
    highlights: ['traffic', 'loadbalancer', 'app', 'compute', 'database', 'storage', 'monitoring', 'backups'],
  },
  optimize: {
    pos:    [4, 7, 17],
    target: [3, -1, 0],
    highlights: ['compute', 'storage', 'database'],
  },
  'managed-care': {
    pos:    [-1, 8, 21],
    target: [0, 0, 0],
    highlights: ['monitoring', 'backups', 'storage'],
  },
  'how-we-work': {
    pos:    [-4, 10, 20],
    target: [-1, 0, 0],
  },
  'why-us': {
    pos:    [-1, 8, 22],
    target: [0, 0, 0],
  },
  faq: {
    pos:    [-1, 8, 22],
    target: [0, 0, 0],
  },
  contact: {
    pos:    [-2, 9, 22],
    target: [0, 0, 0],
    highlights: ['monitoring', 'app', 'loadbalancer'],
  },
};

// ─── COMPONENT ────────────────────────────────────────────────────────────────
interface HoverInfo {
  label: string;
  sublabel: string;
  x: number;
  y: number;
}

export const InfraEnvironment3D: React.FC = () => {
  const mountRef      = useRef<HTMLDivElement>(null);
  const sectionRef    = useRef<SectionId>('hero');
  const sceneReady    = useRef(false);

  // For HTML overlay
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  const [scanActive, setScanActive] = useState(false);

  // ─── Three.js live refs ──────────────────────────────────────────────────
  const rendererRef     = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef       = useRef<THREE.PerspectiveCamera | null>(null);
  const sceneRef        = useRef<THREE.Scene | null>(null);
  const nodeObjectsRef  = useRef<Map<string, THREE.Group>>(new Map());
  const nodeMatsRef     = useRef<Map<string, { body: THREE.MeshStandardMaterial; top: THREE.MeshBasicMaterial }>>(new Map());
  const rafRef          = useRef<number>(0);
  const mouseRef        = useRef(new THREE.Vector2(-10, -10));
  const camPosRef       = useRef(new THREE.Vector3(-2, 9, 22));
  const camTargetRef    = useRef(new THREE.Vector3(0, 0, 0));
  const isTabVisRef     = useRef(true);

  // Raycaster targets
  const rayTargetsRef   = useRef<{ mesh: THREE.Mesh; nodeId: string }[]>([]);

  // ─── Create server rack geometry ─────────────────────────────────────────
  const createRack = useCallback((def: InfraNodeDef): THREE.Group => {
    const group = new THREE.Group();

    const bodyMat = new THREE.MeshStandardMaterial({
      color:     0x1e2b3c,   // dark navy
      roughness: 0.6,
      metalness: 0.3,
    });

    const topMat = new THREE.MeshBasicMaterial({
      color: def.color,
      transparent: true,
      opacity: 0.6,
    });

    const gapY = def.h + 0.06;

    for (let s = 0; s < def.stacks; s++) {
      const yOffset = s * gapY;

      // Slab body
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(def.w, def.h, def.d),
        bodyMat,
      );
      slab.position.y = yOffset;
      slab.castShadow = true;
      slab.receiveShadow = true;
      slab.userData = { nodeId: def.id };
      group.add(slab);

      // Edge lines (subtle wireframe accent)
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(def.w, def.h, def.d)),
        new THREE.LineBasicMaterial({ color: 0x334155, transparent: true, opacity: 0.35 }),
      );
      edges.position.y = yOffset;
      group.add(edges);

      // Top indicator strip (status color)
      const top = new THREE.Mesh(
        new THREE.BoxGeometry(def.w * 0.88, 0.018, def.d * 0.88),
        topMat,
      );
      top.position.y = yOffset + def.h / 2 + 0.009;
      group.add(top);

      // LED dots on front face
      const ledCount = Math.min(5, Math.floor(def.w / 0.25));
      const ledSpacing = (def.w * 0.7) / Math.max(ledCount - 1, 1);
      const ledMat = new THREE.MeshBasicMaterial({ color: 0x4ade80 });
      for (let l = 0; l < ledCount; l++) {
        const led = new THREE.Mesh(
          new THREE.SphereGeometry(0.025, 6, 6),
          ledMat,
        );
        led.position.set(
          -def.w * 0.35 + l * ledSpacing,
          yOffset + def.h / 2 - 0.01,
          def.d / 2 + 0.01,
        );
        group.add(led);
      }

      // Raycaster target: invisible larger box for easy hit detection
      const hitBox = new THREE.Mesh(
        new THREE.BoxGeometry(def.w + 0.4, def.h + 0.4, def.d + 0.4),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
      );
      hitBox.position.y = yOffset;
      hitBox.userData = { nodeId: def.id };
      group.add(hitBox);
      rayTargetsRef.current.push({ mesh: hitBox, nodeId: def.id });
    }

    // Bottom plate (server plinth)
    const plinth = new THREE.Mesh(
      new THREE.BoxGeometry(def.w + 0.1, 0.04, def.d + 0.1),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.8 }),
    );
    plinth.position.y = -0.02;
    group.add(plinth);

    // Store materials for runtime updates
    nodeMatsRef.current.set(def.id, { body: bodyMat, top: topMat });

    return group;
  }, []);

  // ─── Create connection path ───────────────────────────────────────────────
  const createEdge = useCallback(
    (fromPos: THREE.Vector3, toPos: THREE.Vector3): { line: THREE.Line; curve: THREE.QuadraticBezierCurve3 } => {
      // Slight arch for visual clarity
      const mid = fromPos.clone().lerp(toPos, 0.5);
      mid.y += 0.6;

      const curve = new THREE.QuadraticBezierCurve3(fromPos, mid, toPos);
      const pts = curve.getPoints(40);
      const geo = new THREE.BufferGeometry().setFromPoints(pts);

      const mat = new THREE.LineBasicMaterial({
        color:       0x3b5998,
        transparent: true,
        opacity:     0.18,
      });
      const line = new THREE.Line(geo, mat);
      return { line, curve };
    },
    [],
  );

  // ─── MAIN EFFECT: init Three.js once ────────────────────────────────────
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || sceneReady.current) return;

    // WebGL check
    try {
      const t = document.createElement('canvas');
      const ctx = t.getContext('webgl') || t.getContext('experimental-webgl');
      if (!ctx) return;
    } catch { return; }

    sceneReady.current = true;

    const W = window.innerWidth;
    const H = window.innerHeight;

    // ── Renderer ──────────────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'default',
    });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = true;
    // Soft light background (canvas bg set via CSS)
    renderer.setClearColor(0xf4f6f9, 1);
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // ── Scene ─────────────────────────────────────────────────────────────
    const scene = new THREE.Scene();
    // Very subtle depth fog (light)
    scene.fog = new THREE.FogExp2(0xeceff4, 0.012);
    sceneRef.current = scene;

    // ── Camera ────────────────────────────────────────────────────────────
    const camera = new THREE.PerspectiveCamera(46, W / H, 0.1, 200);
    camera.position.set(-2, 9, 22);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // ── Lights ────────────────────────────────────────────────────────────
    // Ambient — soft overall light
    scene.add(new THREE.AmbientLight(0xdce8f5, 2.8));

    // Key light (upper left front) — casts shadows
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(-6, 12, 10);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.far = 60;
    key.shadow.camera.near = 0.5;
    key.shadow.camera.left   = -20;
    key.shadow.camera.right  =  20;
    key.shadow.camera.top    =  20;
    key.shadow.camera.bottom = -20;
    key.shadow.bias = -0.001;
    scene.add(key);

    // Fill light (right, warm)
    const fill = new THREE.DirectionalLight(0xbfdbfe, 1.0);
    fill.position.set(10, 4, -5);
    scene.add(fill);

    // Subtle blue rim from below (bounce)
    const rim = new THREE.PointLight(0x2563eb, 0.6, 40);
    rim.position.set(0, -6, 5);
    scene.add(rim);

    // ── Ground plane (subtle) ─────────────────────────────────────────────
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 60),
      new THREE.MeshStandardMaterial({
        color:     0xe8edf5,
        roughness: 0.9,
        metalness: 0.0,
      }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -2.0;
    ground.receiveShadow = true;
    scene.add(ground);

    // Grid lines on ground (very subtle)
    const gridHelper = new THREE.GridHelper(40, 20, 0xc8d4e8, 0xdde4ef);
    gridHelper.position.y = -1.99;
    (gridHelper.material as THREE.LineBasicMaterial).transparent = true;
    (gridHelper.material as THREE.LineBasicMaterial).opacity = 0.35;
    scene.add(gridHelper);

    // ── Infrastructure nodes ─────────────────────────────────────────────
    const nodeMap = new Map<string, THREE.Group>();
    NODES.forEach(def => {
      const group = createRack(def);
      group.position.set(...def.pos);
      scene.add(group);
      nodeMap.set(def.id, group);
    });
    nodeObjectsRef.current = nodeMap;

    // ── Connection edges ──────────────────────────────────────────────────
    interface EdgeData {
      line: THREE.Line;
      curve: THREE.QuadraticBezierCurve3;
      fromId: string;
      toId: string;
    }
    const edgeDataList: EdgeData[] = [];

    EDGES.forEach(([fromId, toId]) => {
      const fromDef = NODES.find(n => n.id === fromId);
      const toDef   = NODES.find(n => n.id === toId);
      if (!fromDef || !toDef) return;

      const fromPos = new THREE.Vector3(
        fromDef.pos[0] + fromDef.w / 2,
        fromDef.pos[1] + fromDef.h * fromDef.stacks * 0.5,
        fromDef.pos[2],
      );
      const toPos = new THREE.Vector3(
        toDef.pos[0] - toDef.w / 2,
        toDef.pos[1] + toDef.h * toDef.stacks * 0.5,
        toDef.pos[2],
      );

      const { line, curve } = createEdge(fromPos, toPos);
      scene.add(line);
      edgeDataList.push({ line, curve, fromId, toId });
    });

    // ── Data flow particles ────────────────────────────────────────────────
    // One InstancedMesh with enough instances for all edges × 2 particles
    const PARTICLES_PER_EDGE = 3;
    const totalParticles = edgeDataList.length * PARTICLES_PER_EDGE;

    const particleGeo = new THREE.SphereGeometry(0.045, 6, 6);
    const particleMat = new THREE.MeshBasicMaterial({
      color:       0x60a5fa,
      transparent: true,
      opacity:     0.85,
    });
    const particleMesh = new THREE.InstancedMesh(particleGeo, particleMat, totalParticles);
    particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(particleMesh);

    // Track progress per particle
    const particleProgress: number[] = Array.from({ length: totalParticles }, (_, i) =>
      (i / PARTICLES_PER_EDGE) % 1,
    );
    const particleEdgeIdx: number[] = [];
    for (let e = 0; e < edgeDataList.length; e++) {
      for (let p = 0; p < PARTICLES_PER_EDGE; p++) {
        particleEdgeIdx.push(e);
      }
    }

    rayTargetsRef.current = [];

    // ── Raycaster ─────────────────────────────────────────────────────────
    const raycaster = new THREE.Raycaster();
    let hoveredId: string | null = null;

    // ── Pointer events (global window tracking) ───────────────────────────
    const onPointerMove = (e: MouseEvent) => {
      mouseRef.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouseRef.current.y = -(e.clientY / window.innerHeight) * 2 + 1;
    };

    const onPointerLeave = () => {
      mouseRef.current.set(-10, -10);
      if (hoveredId !== null) {
        hoveredId = null;
        setHoverInfo(null);
      }
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('mouseleave', onPointerLeave);

    // ── Resize ─────────────────────────────────────────────────────────────
    const onResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize, { passive: true });

    // ── Tab visibility ─────────────────────────────────────────────────────
    const onVis = () => { isTabVisRef.current = !document.hidden; };
    document.addEventListener('visibilitychange', onVis);

    // ── IntersectionObserver: section tracking ─────────────────────────────
    const SECTION_IDS: SectionId[] = [
      'hero', 'problem', 'services', 'health-check',
      'optimize', 'managed-care', 'how-we-work', 'why-us', 'faq', 'contact',
    ];

    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting && entry.intersectionRatio > 0.3) {
            const id = entry.target.id as SectionId;
            if (SECTION_IDS.includes(id)) {
              sectionRef.current = id;
              // Update camera target from section config
              const cfg = SECTION_CAMS[id] ?? SECTION_CAMS.hero;
              camPosRef.current.set(...cfg.pos);
              camTargetRef.current.set(...cfg.target);
            }
          }
        });
      },
      { threshold: [0.2, 0.5] },
    );

    // Delay to let DOM render
    setTimeout(() => {
      SECTION_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) observer.observe(el);
      });
    }, 500);

    // ── Scan animation state ───────────────────────────────────────────────
    let scanProgress = 0;
    let scanRunning  = false;

    // ── Health check scan trigger ─────────────────────────────────────────
    const healthCheckEl = document.getElementById('health-check');
    const scanObserver = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !scanRunning) {
          scanRunning = true;
          scanProgress = 0;
          setScanActive(true);
          setTimeout(() => setScanActive(false), 4000);
        } else if (!entry.isIntersecting) {
          scanRunning = false;
        }
      },
      { threshold: 0.5 },
    );
    if (healthCheckEl) scanObserver.observe(healthCheckEl);

    // ── Animation loop ─────────────────────────────────────────────────────
    const startTime = performance.now();
    let lastTime = 0;
    const dummy = new THREE.Object3D();
    const currentLookAt = new THREE.Vector3(0, 0, 0);

    const animate = (time: number) => {
      rafRef.current = requestAnimationFrame(animate);
      if (!isTabVisRef.current) return;
      // Throttle to ~60fps
      if (time - lastTime < 12) return;
      lastTime = time;

      const t   = (time - startTime) * 0.001;
      const cfg = SECTION_CAMS[sectionRef.current] ?? SECTION_CAMS.hero;

      // ── Camera lerp ───────────────────────────────────────────────────
      // Target includes slight mouse parallax
      const targetX = cfg.pos[0] + mouseRef.current.x * 0.8;
      const targetY = cfg.pos[1] + mouseRef.current.y * 0.5;
      const targetZ = cfg.pos[2];

      camera.position.x += (targetX - camera.position.x) * 0.025;
      camera.position.y += (targetY - camera.position.y) * 0.025;
      camera.position.z += (targetZ - camera.position.z) * 0.025;

      const tgt = new THREE.Vector3(...cfg.target);
      const desiredLookAt = new THREE.Vector3(
        tgt.x + mouseRef.current.x * 0.35,
        tgt.y + mouseRef.current.y * 0.2,
        tgt.z,
      );
      currentLookAt.lerp(desiredLookAt, 0.035);
      camera.lookAt(currentLookAt);

      // ── Node state updates ────────────────────────────────────────────
      const highlights = cfg.highlights ?? [];
      const dimmed     = cfg.dimmed     ?? [];

      NODES.forEach(def => {
        const mats = nodeMatsRef.current.get(def.id);
        if (!mats) return;

        const isHighlighted = highlights.length === 0 || highlights.includes(def.id);
        const isDimmed      = dimmed.includes(def.id);

        // Body opacity
        const targetBodyOpacity = isDimmed ? 0.35 : 1.0;
        mats.body.opacity = mats.body.opacity ?? 1.0;
        if (!mats.body.transparent) mats.body.transparent = true;
        mats.body.opacity += (targetBodyOpacity - mats.body.opacity) * 0.04;

        // Top indicator intensity
        const targetTopOpacity = isHighlighted && !isDimmed ? 0.85 : 0.25;
        mats.top.opacity += (targetTopOpacity - mats.top.opacity) * 0.04;

        // Scan animation: sequential highlight
        if (scanRunning) {
          const nodeIdx = NODES.findIndex(n => n.id === def.id);
          const scanThreshold = scanProgress * NODES.length;
          const scanned = nodeIdx < scanThreshold;
          const targetScan = scanned ? 0.95 : 0.15;
          mats.top.opacity += (targetScan - mats.top.opacity) * 0.08;
        }

        // Subtle float animation per rack
        const nodeGroup = nodeObjectsRef.current.get(def.id);
        if (nodeGroup) {
          const floatAmt = isDimmed ? 0.0 : 0.04;
          nodeGroup.position.y = def.pos[1] + Math.sin(t * 0.7 + def.pos[0] * 0.5) * floatAmt;
        }
      });

      // Advance scan
      if (scanRunning) {
        scanProgress = Math.min(scanProgress + 0.004, 1.0);
        if (scanProgress >= 1.0) scanRunning = false;
      }

      // ── Edge opacity based on section ─────────────────────────────────
      edgeDataList.forEach(({ line, fromId, toId }) => {
        const mat = line.material as THREE.LineBasicMaterial;
        const active =
          highlights.length === 0 ||
          (highlights.includes(fromId) && highlights.includes(toId));
        const targetOpacity = active ? 0.22 : 0.06;
        mat.opacity += (targetOpacity - mat.opacity) * 0.04;
      });

      // ── Data flow particles ───────────────────────────────────────────
      const particleSpeed = 0.003;
      for (let i = 0; i < totalParticles; i++) {
        const edgeIdx = particleEdgeIdx[i];
        const edge    = edgeDataList[edgeIdx];
        particleProgress[i] = (particleProgress[i] + particleSpeed) % 1;
        const pt = edge.curve.getPoint(particleProgress[i]);
        dummy.position.copy(pt);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        particleMesh.setMatrixAt(i, dummy.matrix);

        // Opacity matches edge
        const active =
          highlights.length === 0 ||
          (highlights.includes(edge.fromId) && highlights.includes(edge.toId));
        // We can't per-instance set opacity easily, but at least all instances share the mat
      }
      particleMesh.instanceMatrix.needsUpdate = true;

      // ── Raycasting for hover ──────────────────────────────────────────
      raycaster.setFromCamera(mouseRef.current, camera);
      const hits = raycaster.intersectObjects(
        rayTargetsRef.current.map(r => r.mesh),
      );

      if (hits.length > 0) {
        hoveredId = hits[0].object.userData.nodeId as string;
      } else {
        hoveredId = null;
      }

      if (hoveredId) {
        const def = NODES.find(n => n.id === hoveredId);
        if (def && cameraRef.current) {
          const pos3D = new THREE.Vector3(...def.pos);
          pos3D.y += def.h * def.stacks + 0.6;
          const projected = pos3D.project(camera);
          if (projected.z < 1) {
            const x = (projected.x * 0.5 + 0.5) * window.innerWidth;
            const y = (-projected.y * 0.5 + 0.5) * window.innerHeight;
            setHoverInfo({ label: def.label, sublabel: def.sublabel, x, y });
          }
        }
      } else {
        setHoverInfo(null);
      }

      renderer.render(scene, camera);
    };

    rafRef.current = requestAnimationFrame(animate);

    // ── Cleanup ────────────────────────────────────────────────────────────
    return () => {
      cancelAnimationFrame(rafRef.current);
      observer.disconnect();
      scanObserver.disconnect();
      window.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('mouseleave', onPointerLeave);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVis);

      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
      renderer.dispose();
      sceneReady.current = false;
    };
  // Runs once only
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {/* Canvas mount */}
      <div
        ref={mountRef}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 0,
          width:  '100%',
          height: '100%',
          // Let pointer events pass through to page content except in hero
          pointerEvents: 'none',
        }}
        aria-hidden="true"
      />

      {/* Node hover tooltip — HTML overlay */}
      {hoverInfo && (
        <div
          style={{
            position: 'fixed',
            left:     hoverInfo.x,
            top:      hoverInfo.y,
            zIndex:   50,
            transform: 'translate(-50%, -130%)',
            pointerEvents: 'none',
            animation: 'fade-in 0.15s ease both',
          }}
        >
          <div
            style={{
              padding: '8px 14px',
              borderRadius: '8px',
              background: 'rgba(13,31,60,0.88)',
              backdropFilter: 'blur(8px)',
              border: '1px solid rgba(59,130,246,0.25)',
              boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
              whiteSpace: 'nowrap',
            }}
          >
            <div
              style={{
                fontSize: '0.68rem',
                fontWeight: 700,
                letterSpacing: '0.10em',
                textTransform: 'uppercase',
                color: '#93c5fd',
                marginBottom: '2px',
              }}
            >
              {hoverInfo.label}
            </div>
            <div style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.75)', fontWeight: 400 }}>
              {hoverInfo.sublabel}
            </div>
          </div>
          {/* Pointer caret */}
          <div
            style={{
              width: 0,
              height: 0,
              borderLeft: '5px solid transparent',
              borderRight: '5px solid transparent',
              borderTop: '6px solid rgba(13,31,60,0.88)',
              margin: '0 auto',
            }}
          />
        </div>
      )}

      {/* Health check scan indicator */}
      {scanActive && (
        <div
          style={{
            position: 'fixed',
            bottom: '32px',
            left:   '50%',
            transform: 'translateX(-50%)',
            zIndex: 50,
            pointerEvents: 'none',
            animation: 'fade-in 0.3s ease both',
          }}
        >
          <div
            style={{
              padding: '8px 20px',
              borderRadius: '100px',
              background: 'rgba(5,150,105,0.12)',
              border: '1px solid rgba(5,150,105,0.3)',
              fontSize: '0.72rem',
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: '#059669',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <span
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: '#059669',
                animation: 'pulse-dot 0.8s ease-in-out infinite',
              }}
            />
            Scanning infrastructure — illustrative assessment
          </div>
        </div>
      )}
    </>
  );
};
