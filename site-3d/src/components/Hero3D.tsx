import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

/**
 * The hero surface: a field of particles that behaves like a slow tide.
 *
 * Deliberately light-themed — ink dots on paper rather than glowing neon — so the
 * page reads as a data firm's instrument panel, not a gaming splash. The pointer
 * lifts the field near the cursor; scrolling tilts it. Everything else is quiet.
 */

const COLS = 110;
const ROWS = 54;
const SPAN_X = 9.5;
const SPAN_Z = 5.4;

function Tide({ pointer, progress }: { pointer: React.MutableRefObject<{ x: number; y: number }>; progress: React.MutableRefObject<number> }) {
  const points = useRef<THREE.Points>(null);
  const rings = useRef<THREE.Group>(null);
  const field = useRef<THREE.Group>(null);
  const { size } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  // The field sits at world y = -0.5, so the plane is y + 0.5 = 0.
  const groundPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.5), []);
  const hitPoint = useMemo(() => new THREE.Vector3(), []);

  const { geometry, base } = useMemo(() => {
    const count = COLS * ROWS;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const base = new Float32Array(count * 2);

    const ink = new THREE.Color("#14160f");
    const accent = new THREE.Color("#4f3ce8");
    const lime = new THREE.Color("#a8c93a");

    let i = 0;
    for (let r = 0; r < ROWS; r += 1) {
      for (let c = 0; c < COLS; c += 1) {
        const x = (c / (COLS - 1) - 0.5) * SPAN_X;
        const z = (r / (ROWS - 1) - 0.5) * SPAN_Z;
        positions[i * 3] = x;
        positions[i * 3 + 1] = 0;
        positions[i * 3 + 2] = z;
        base[i * 2] = x;
        base[i * 2 + 1] = z;

        // A sparse minority in colour keeps the field from reading as noise.
        const roll = Math.random();
        const col = roll > 0.975 ? accent : roll > 0.93 ? lime : ink;
        colors[i * 3] = col.r;
        colors[i * 3 + 1] = col.g;
        colors[i * 3 + 2] = col.b;

        i += 1;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return { geometry, base };
  }, []);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const pos = geometry.getAttribute("position") as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;

    // Project the pointer onto the field's own plane, then into the field's local
    // space. A linear screen->world guess ignored the group offset and the camera
    // tilt, which is why the ripple never sat under the cursor.
    let mx = 999;
    let mz = 999;
    raycaster.setFromCamera(pointer.current as unknown as THREE.Vector2, state.camera);
    if (raycaster.ray.intersectPlane(groundPlane, hitPoint) && field.current) {
      field.current.worldToLocal(hitPoint);
      mx = hitPoint.x;
      mz = hitPoint.z;
    }
    const amp = 0.34 + progress.current * 0.5;

    for (let i = 0; i < COLS * ROWS; i += 1) {
      const x = base[i * 2];
      const z = base[i * 2 + 1];
      const wave =
        Math.sin(x * 0.62 + t * 0.55) * 0.30 +
        Math.cos(z * 0.78 - t * 0.42) * 0.24 +
        Math.sin((x + z) * 0.4 + t * 0.3) * 0.12;

      // Distance to the pointer, lifted smoothly rather than as a spike.
      const dx = x - mx;
      const dz = z - mz;
      const lift = Math.exp(-(dx * dx + dz * dz) * 0.34) * 1.05;

      arr[i * 3 + 1] = wave * amp + lift * 0.7;
    }
    pos.needsUpdate = true;

    if (rings.current) {
      rings.current.rotation.z = t * 0.05;
      rings.current.rotation.x = -Math.PI / 2.36 + progress.current * 0.12;
    }
  });

  const scale = size.width < 860 ? 0.72 : 1;

  return (
    <group ref={field} position={[3.1, -0.5, 0]} scale={scale}>
      <points ref={points} geometry={geometry}>
        <pointsMaterial size={0.022} sizeAttenuation vertexColors transparent opacity={0.92} depthWrite={false} />
      </points>
      <group ref={rings} position={[0, -0.15, 0]}>
        {[3.4, 4.3].map((r, i) => (
          <mesh key={r}>
            <torusGeometry args={[r, 0.0028, 6, 160]} />
            <meshBasicMaterial color={i === 1 ? "#4f3ce8" : "#14160f"} transparent opacity={i === 1 ? 0.34 : 0.12} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

export function Hero3D() {
  const pointer = useRef({ x: 0, y: 0 });
  const progress = useRef(0);
  const [enabled, setEnabled] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const small = window.matchMedia("(max-width: 860px)").matches;
    // Phones get the gradient: 240KB of WebGL that fights the copy is not a
    // trade worth making, and the static version still looks deliberate.
    setEnabled(!reduce && !small);
    if (reduce || small) return;

    const onMove = (event: PointerEvent) => {
      pointer.current.x = (event.clientX / window.innerWidth) * 2 - 1;
      // WebGL NDC: y is +1 at the top. (clientY is 0 at the top, so this is
      // 1 - 2*(top fraction). The old formula had the sign inverted, which is
      // why the ripple moved opposite to the cursor on the vertical axis.
      pointer.current.y = 1 - (event.clientY / window.innerHeight) * 2;
    };
    const onScroll = () => {
      progress.current = Math.min(1, window.scrollY / Math.max(1, window.innerHeight));
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <div className="hero-canvas" ref={wrap} aria-hidden="true">
      {enabled ? (
        <Canvas
          camera={{ position: [0, 2.15, 4.6], fov: 42 }}
          dpr={[1, 1.75]}
          gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        >
          <Tide pointer={pointer} progress={progress} />
        </Canvas>
      ) : (
        <div className="hero-fallback" />
      )}
    </div>
  );
}
