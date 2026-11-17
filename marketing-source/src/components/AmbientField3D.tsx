import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

/** A quiet 3D topology that sits behind the page and responds to the reader. */
export const AmbientField3D: React.FC = () => {
  const mountRef = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
    } catch {
      setAvailable(false);
      return;
    }

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 80);
    camera.position.set(0, 0, 11.5);
    camera.lookAt(0, 0, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    mount.appendChild(renderer.domElement);

    const ambient = new THREE.Group();
    scene.add(ambient);

    const topology = new THREE.Group();
    ambient.add(topology);
    const lines = new THREE.LineBasicMaterial({ color: 0xa6d76a, transparent: true, opacity: 0.8, depthWrite: false });
    const softLines = new THREE.LineBasicMaterial({ color: 0xb8cfaa, transparent: true, opacity: 0.42, depthWrite: false });
    const greenNode = new THREE.MeshBasicMaterial({ color: 0xc9f477, transparent: true, opacity: 0.92 });
    const dimNode = new THREE.MeshBasicMaterial({ color: 0x93aa86, transparent: true, opacity: 0.72 });

    // A faceted orbital shell: enough structure to read as a real 3D object,
    // without turning the background into another dashboard.
    const shellGeometry = new THREE.IcosahedronGeometry(2.35, 2);
    const shellEdges = new THREE.EdgesGeometry(shellGeometry, 10);
    const shell = new THREE.LineSegments(shellEdges, lines);
    shell.position.z = -0.18;
    topology.add(shell);

    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(2.22, 64, 48),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { uTime: { value: 0 } },
        vertexShader: `
          varying vec3 vWorldPosition;
          varying vec3 vWorldNormal;
          void main() {
            vec4 worldPosition = modelMatrix * vec4(position, 1.0);
            vWorldPosition = worldPosition.xyz;
            vWorldNormal = normalize(mat3(modelMatrix) * normal);
            gl_Position = projectionMatrix * viewMatrix * worldPosition;
          }
        `,
        fragmentShader: `
          uniform float uTime;
          varying vec3 vWorldPosition;
          varying vec3 vWorldNormal;
          void main() {
            vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
            float edge = pow(1.0 - max(dot(normalize(vWorldNormal), viewDirection), 0.0), 2.25);
            float flow = sin(vWorldPosition.y * 5.0 + sin(vWorldPosition.x * 3.4 + uTime * 0.22) * 0.8 + uTime * 0.12);
            float contours = 1.0 - smoothstep(0.0, 0.12, abs(flow));
            float cloud = 0.5 + 0.5 * sin(vWorldPosition.x * 1.8 + vWorldPosition.z * 2.1 + sin(vWorldPosition.y * 2.3 + uTime * 0.12));
            vec3 deep = vec3(0.025, 0.075, 0.04);
            vec3 forest = vec3(0.11, 0.31, 0.13);
            vec3 signal = vec3(0.56, 0.84, 0.22);
            vec3 color = mix(deep, forest, cloud * 0.85);
            color = mix(color, signal, clamp(edge * 0.56 + contours * 0.23, 0.0, 0.7));
            float alpha = clamp(0.27 + edge * 0.36 + contours * 0.18, 0.27, 0.72);
            gl_FragColor = vec4(color, alpha);
          }
        `,
      }),
    );
    atmosphere.position.z = -0.12;
    topology.add(atmosphere);

    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.88, 2),
      new THREE.MeshBasicMaterial({ color: 0xb7d28c, transparent: true, opacity: 0.14, wireframe: true, depthWrite: false }),
    );
    core.position.set(0, 0, -0.08);
    topology.add(core);

    const orbitMaterial = new THREE.MeshBasicMaterial({ color: 0xa9d871, transparent: true, opacity: 0.66, depthWrite: false });
    const orbitA = new THREE.Mesh(new THREE.TorusGeometry(2.85, 0.009, 6, 180), orbitMaterial);
    orbitA.rotation.set(0.74, 0.12, 0.18);
    topology.add(orbitA);
    const orbitB = new THREE.Mesh(new THREE.TorusGeometry(3.18, 0.007, 6, 180), softLines);
    orbitB.rotation.set(1.1, -0.38, -0.35);
    topology.add(orbitB);
    const orbitC = new THREE.Mesh(new THREE.TorusGeometry(2.48, 0.006, 6, 180), softLines);
    orbitC.rotation.set(0.3, 0.72, 0.9);
    topology.add(orbitC);

    // A sparse field of linked points adds depth at the edges of the shell.
    const pointPositions: number[] = [];
    const pointGeometry = new THREE.BufferGeometry();
    for (let i = 0; i < 86; i += 1) {
      const t = (i + 0.5) / 86;
      const phi = Math.acos(1 - 2 * t);
      const theta = Math.PI * (1 + Math.sqrt(5)) * i;
      const radius = 2.18 + (i % 4) * 0.13;
      pointPositions.push(
        radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.sin(phi) * Math.sin(theta),
        radius * Math.cos(phi),
      );
    }
    pointGeometry.setAttribute('position', new THREE.Float32BufferAttribute(pointPositions, 3));
    const pointCloud = new THREE.Points(pointGeometry, new THREE.PointsMaterial({ color: 0xc2e693, size: 0.052, transparent: true, opacity: 0.8, sizeAttenuation: true, depthWrite: false }));
    topology.add(pointCloud);

    const spokes: THREE.Vector3[] = [];
    for (let i = 0; i < 12; i += 1) {
      const angle = (i / 12) * Math.PI * 2;
      const y = Math.sin(i * 1.7) * 1.8;
      const radius = 3.28 + Math.cos(i * 0.9) * 0.2;
      const point = new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius * 0.62);
      const anchor = point.clone().normalize().multiplyScalar(2.2);
      spokes.push(anchor, point);
      const node = new THREE.Mesh(new THREE.SphereGeometry(i % 4 === 0 ? 0.052 : 0.032, 10, 10), i % 4 === 0 ? greenNode : dimNode);
      node.position.copy(point);
      topology.add(node);
    }
    const spokeGeometry = new THREE.BufferGeometry().setFromPoints(spokes);
    topology.add(new THREE.LineSegments(spokeGeometry, softLines));

    const pulse = new THREE.Mesh(new THREE.SphereGeometry(0.067, 12, 12), greenNode);
    topology.add(pulse);

    const pointer = new THREE.Vector2();
    let scrollProgress = 0;
    let animationFrame = 0;
    let animationTime = 0;
    let pageVisible = !document.hidden;
    let baseX = 3.05;
    const measure = () => {
      const width = Math.max(1, window.innerWidth);
      const height = Math.max(1, window.innerHeight);
      const aspect = width / height;
      renderer.setSize(width, height, false);
      camera.aspect = aspect;
      camera.position.z = aspect < 0.82 ? 12.6 : 11.5;
      camera.updateProjectionMatrix();
      baseX = aspect < 0.82 ? 0.2 : Math.min(3.4, aspect * 1.85);
      ambient.position.x = baseX;
      if (reducedMotion) renderer.render(scene, camera);
    };

    const readScroll = () => {
      const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      scrollProgress = Math.min(1, Math.max(0, window.scrollY / maxScroll));
      if (reducedMotion) draw();
    };
    const onPointerMove = (event: PointerEvent) => {
      pointer.set((event.clientX / window.innerWidth) * 2 - 1, 1 - (event.clientY / window.innerHeight) * 2);
      if (reducedMotion) draw();
    };
    const onPointerLeave = () => {
      pointer.set(0, 0);
      if (reducedMotion) draw();
    };
    const onVisibilityChange = () => {
      pageVisible = !document.hidden;
      if (pageVisible) draw();
      else window.cancelAnimationFrame(animationFrame);
    };

    const draw = () => {
      if (!pageVisible) return;
      if (!reducedMotion) animationFrame = window.requestAnimationFrame(draw);
      animationTime += reducedMotion ? 0 : 0.0035;
      (atmosphere.material as THREE.ShaderMaterial).uniforms.uTime.value = animationTime;
      const scroll = scrollProgress;
      const targetX = baseX + pointer.x * 0.34 + Math.sin(scroll * Math.PI * 2) * 0.42;
      const targetY = 0.14 - scroll * 0.95 + pointer.y * 0.2;
      const targetRotX = 0.06 + pointer.y * 0.075 + scroll * 0.22;
      const targetRotY = scroll * 1.05 + pointer.x * 0.12 + Math.sin(animationTime) * 0.018;
      const easing = reducedMotion ? 1 : 0.035;
      ambient.position.x += (targetX - ambient.position.x) * easing;
      ambient.position.y += (targetY - ambient.position.y) * easing;
      topology.rotation.x += (targetRotX - topology.rotation.x) * easing;
      topology.rotation.y += (targetRotY - topology.rotation.y) * easing;
      topology.rotation.z += ((pointer.x * -0.035) - topology.rotation.z) * easing;
      pulse.position.set(Math.cos(animationTime * 0.75) * 2.85, Math.sin(animationTime * 0.75) * 1.35, Math.sin(animationTime * 0.75) * 1.4);
      renderer.render(scene, camera);
    };

    measure();
    readScroll();
    window.addEventListener('resize', measure, { passive: true });
    window.addEventListener('scroll', readScroll, { passive: true });
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerleave', onPointerLeave);
    document.addEventListener('visibilitychange', onVisibilityChange);
    draw();

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', readScroll);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerleave', onPointerLeave);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      scene.traverse(object => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments || object instanceof THREE.Points) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach(material => material.dispose());
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div className={`ambient-layer ${available ? '' : 'ambient-fallback'}`} ref={mountRef} aria-hidden="true" />;
};
