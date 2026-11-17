import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

function roundedPlateShape(width: number, height: number, radius: number) {
  const shape = new THREE.Shape();
  const left = -width / 2;
  const right = width / 2;
  const top = height / 2;
  const bottom = -height / 2;
  shape.moveTo(left + radius, bottom);
  shape.lineTo(right - radius, bottom);
  shape.quadraticCurveTo(right, bottom, right, bottom + radius);
  shape.lineTo(right, top - radius);
  shape.quadraticCurveTo(right, top, right - radius, top);
  shape.lineTo(left + radius, top);
  shape.quadraticCurveTo(left, top, left, top - radius);
  shape.lineTo(left, bottom + radius);
  shape.quadraticCurveTo(left, bottom, left + radius, bottom);
  return shape;
}

export const OperationsCore3D: React.FC = () => {
  const mountRef = useRef<HTMLDivElement>(null);
  const [webglAvailable, setWebglAvailable] = useState(true);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
    } catch {
      setWebglAvailable(false);
      return;
    }

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(5.35, 3.45, 8.25);
    camera.lookAt(0, 0.05, 0);

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.65));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xe9f2dc, 0x142019, 2.2));
    const keyLight = new THREE.DirectionalLight(0xf4edcf, 3.3);
    keyLight.position.set(-3.5, 7, 5);
    scene.add(keyLight);
    const greenRim = new THREE.PointLight(0xb9f178, 3.4, 10, 2);
    greenRim.position.set(3, 1.8, -2.2);
    scene.add(greenRim);
    const coolRim = new THREE.PointLight(0x78a89b, 2.3, 9, 2);
    coolRim.position.set(-4, 0.5, -1.5);
    scene.add(coolRim);

    const assembly = new THREE.Group();
    scene.add(assembly);
    const sculpture = new THREE.Group();
    assembly.add(sculpture);

    const graphite = new THREE.MeshStandardMaterial({ color: 0x26352b, metalness: 0.78, roughness: 0.3 });
    const graphiteLight = new THREE.MeshStandardMaterial({ color: 0x52604d, metalness: 0.7, roughness: 0.32 });
    const darkGlass = new THREE.MeshPhysicalMaterial({ color: 0x516f56, metalness: 0.24, roughness: 0.18, transmission: 0.18, thickness: 0.8, clearcoat: 0.9, clearcoatRoughness: 0.15 });
    const lime = new THREE.MeshStandardMaterial({ color: 0xc9f477, emissive: 0x7ea83d, emissiveIntensity: 1.2, metalness: 0.3, roughness: 0.22 });
    const paleMetal = new THREE.MeshStandardMaterial({ color: 0xd1d5bd, metalness: 0.85, roughness: 0.27 });
    const lineMaterial = new THREE.MeshBasicMaterial({ color: 0xc9f477, transparent: true, opacity: 0.52 });

    // A floating machined platform gives the infrastructure a physical footprint.
    const plateGeometry = new THREE.ExtrudeGeometry(roundedPlateShape(4.85, 3.55, 0.34), {
      depth: 0.2,
      bevelEnabled: true,
      bevelSegments: 3,
      steps: 1,
      bevelSize: 0.06,
      bevelThickness: 0.055,
      curveSegments: 8,
    });
    plateGeometry.rotateX(-Math.PI / 2);
    const plate = new THREE.Mesh(plateGeometry, graphite);
    plate.position.y = -1.1;
    plate.castShadow = true;
    plate.receiveShadow = true;
    sculpture.add(plate);

    const edge = new THREE.Mesh(new THREE.BoxGeometry(4.36, 0.018, 3.06), new THREE.MeshBasicMaterial({ color: 0xa6c66a, transparent: true, opacity: 0.25 }));
    edge.position.set(0, -0.837, 0);
    sculpture.add(edge);

    // Fine inlaid lines make the plinth read like a designed instrument.
    const guideMaterial = new THREE.LineBasicMaterial({ color: 0x8d9f7a, transparent: true, opacity: 0.22 });
    const gridPoints: THREE.Vector3[] = [];
    for (let x = -1.7; x <= 1.71; x += 0.57) {
      gridPoints.push(new THREE.Vector3(x, -0.837, -1.25), new THREE.Vector3(x, -0.837, 1.25));
    }
    for (let z = -1.2; z <= 1.21; z += 0.6) {
      gridPoints.push(new THREE.Vector3(-1.72, -0.837, z), new THREE.Vector3(1.72, -0.837, z));
    }
    const guides = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(gridPoints), guideMaterial);
    sculpture.add(guides);

    // Three quiet server monoliths, with inset channels and fine indicator lights.
    const towers = [
      { x: -1.18, height: 1.22, width: 0.58, depth: 0.62 },
      { x: 0, height: 1.68, width: 0.68, depth: 0.72 },
      { x: 1.18, height: 1.34, width: 0.6, depth: 0.64 },
    ];
    for (const [index, tower] of towers.entries()) {
      const towerGroup = new THREE.Group();
      towerGroup.position.set(tower.x, -0.83 + tower.height / 2, 0.15);
      sculpture.add(towerGroup);
      const body = new THREE.Mesh(new THREE.BoxGeometry(tower.width, tower.height, tower.depth), index === 1 ? graphiteLight : graphite);
      body.castShadow = true;
      body.receiveShadow = true;
      towerGroup.add(body);
      const face = new THREE.Mesh(new THREE.BoxGeometry(tower.width * 0.76, tower.height * 0.82, 0.016), new THREE.MeshStandardMaterial({ color: 0x17231b, metalness: 0.38, roughness: 0.48 }));
      face.position.set(0, 0, tower.depth / 2 + 0.009);
      towerGroup.add(face);
      const levels = Math.floor(tower.height * 5.4);
      for (let level = 0; level < levels; level += 1) {
        const y = -tower.height * 0.38 + (level / Math.max(1, levels - 1)) * tower.height * 0.76;
        const seam = new THREE.Mesh(new THREE.BoxGeometry(tower.width * 0.59, 0.012, 0.021), paleMetal);
        seam.position.set(-0.02, y, tower.depth / 2 + 0.022);
        towerGroup.add(seam);
        const light = new THREE.Mesh(new THREE.SphereGeometry(0.024, 10, 10), level % 3 === 0 ? lime : lineMaterial);
        light.position.set(tower.width * 0.27, y, tower.depth / 2 + 0.035);
        towerGroup.add(light);
      }
      const cap = new THREE.Mesh(new THREE.BoxGeometry(tower.width * 0.84, 0.035, tower.depth * 0.84), paleMetal);
      cap.position.y = tower.height / 2 + 0.018;
      towerGroup.add(cap);
    }

    // A glass core and three unequal orbital rings form the center of the system.
    const core = new THREE.Group();
    core.position.set(0, 0.88, -0.08);
    sculpture.add(core);
    const outerOrb = new THREE.Mesh(new THREE.SphereGeometry(0.72, 48, 36), darkGlass);
    outerOrb.castShadow = true;
    core.add(outerOrb);
    const innerOrb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 2), new THREE.MeshPhysicalMaterial({ color: 0xa4ce75, metalness: 0.62, roughness: 0.23, clearcoat: 1, clearcoatRoughness: 0.12 }));
    core.add(innerOrb);
    const corePin = new THREE.Mesh(new THREE.SphereGeometry(0.1, 24, 18), new THREE.MeshBasicMaterial({ color: 0xe3f5b4 }));
    corePin.position.set(0.12, 0.08, 0.39);
    core.add(corePin);

    const ringMat = new THREE.MeshStandardMaterial({ color: 0xd7d5b5, metalness: 0.91, roughness: 0.19, emissive: 0x242b17, emissiveIntensity: 0.35 });
    const ringA = new THREE.Mesh(new THREE.TorusGeometry(1.08, 0.018, 10, 120), ringMat);
    ringA.rotation.x = Math.PI / 2.34;
    ringA.rotation.y = 0.38;
    core.add(ringA);
    const ringB = new THREE.Mesh(new THREE.TorusGeometry(0.92, 0.012, 10, 120), lime);
    ringB.rotation.x = Math.PI / 1.8;
    ringB.rotation.y = -0.5;
    core.add(ringB);
    const ringC = new THREE.Mesh(new THREE.TorusGeometry(1.24, 0.009, 8, 120), paleMetal);
    ringC.rotation.x = Math.PI / 2.7;
    ringC.rotation.z = 0.22;
    core.add(ringC);

    const orbitNodePositions = [
      new THREE.Vector3(-1.42, 0.22, 0.1),
      new THREE.Vector3(1.34, 0.15, 0.25),
      new THREE.Vector3(0.12, -0.36, 1.19),
      new THREE.Vector3(-0.36, 0.84, -0.78),
      new THREE.Vector3(1.02, -0.48, -0.68),
    ];
    orbitNodePositions.forEach((position, index) => {
      const node = new THREE.Mesh(new THREE.SphereGeometry(index === 2 ? 0.08 : 0.055, 16, 12), index === 3 ? paleMetal : lime);
      node.position.copy(position);
      node.castShadow = true;
      core.add(node);
    });

    // Hairline routes stitch the central core to the three infrastructure modules.
    const routes = [
      [new THREE.Vector3(-0.28, 0.18, -0.04), new THREE.Vector3(-0.65, -0.18, 0.08), new THREE.Vector3(-1.18, -0.34, 0.15)],
      [new THREE.Vector3(0.22, 0.12, 0.02), new THREE.Vector3(0.62, -0.16, 0.1), new THREE.Vector3(1.18, -0.2, 0.15)],
      [new THREE.Vector3(0, -0.15, -0.04), new THREE.Vector3(0, -0.55, 0.08), new THREE.Vector3(0, -0.84, 0.15)],
    ];
    routes.forEach((points, index) => {
      const curve = new THREE.CatmullRomCurve3(points);
      const route = new THREE.Mesh(new THREE.TubeGeometry(curve, 22, 0.012, 6, false), index === 1 ? new THREE.MeshBasicMaterial({ color: 0xe6e2c8, transparent: true, opacity: 0.54 }) : lineMaterial);
      sculpture.add(route);
      const endpoint = new THREE.Mesh(new THREE.SphereGeometry(0.038, 10, 10), lime);
      endpoint.position.copy(points[points.length - 1]);
      sculpture.add(endpoint);
    });

    // Discrete corner fasteners complete the crafted tabletop object.
    const screwGeometry = new THREE.CylinderGeometry(0.045, 0.045, 0.016, 20);
    const screwPositions = [[-2.1, -0.82, -1.45], [2.1, -0.82, -1.45], [-2.1, -0.82, 1.45], [2.1, -0.82, 1.45]];
    screwPositions.forEach(([x, y, z]) => {
      const screw = new THREE.Mesh(screwGeometry, paleMetal);
      screw.position.set(x, y, z);
      sculpture.add(screw);
    });

    const resize = () => {
      if (!mount) return;
      const width = Math.max(1, mount.clientWidth);
      const height = Math.max(1, mount.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.position.z = width < 520 ? 13 : 8.25;
      camera.position.x = width < 520 ? 4.2 : 5.35;
      camera.lookAt(0, 0.05, 0);
      camera.updateProjectionMatrix();
      if (reducedMotion) renderer.render(scene, camera);
    };
    resize();

    let animationFrame = 0;
    let pointerX = 0;
    let pointerY = 0;
    let animationTime = 0;
    const onPointerMove = (event: PointerEvent) => {
      pointerX = (event.clientX / window.innerWidth - 0.5) * 2;
      pointerY = (event.clientY / window.innerHeight - 0.5) * 2;
    };
    const onPointerLeave = () => { pointerX = 0; pointerY = 0; };
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerleave', onPointerLeave);
    window.addEventListener('resize', resize, { passive: true });

    const render = () => {
      if (!reducedMotion) animationFrame = window.requestAnimationFrame(render);
      if (!reducedMotion) animationTime += 0.006;
      const targetX = reducedMotion ? -0.12 : -0.12 + pointerY * 0.045;
      const targetY = reducedMotion ? 0.12 : 0.12 + pointerX * 0.075;
      assembly.rotation.x += (targetX - assembly.rotation.x) * 0.035;
      assembly.rotation.y += (targetY + (reducedMotion ? 0 : Math.sin(animationTime) * 0.035) - assembly.rotation.y) * 0.025;
      sculpture.position.y = reducedMotion ? 0 : Math.sin(animationTime * 1.25) * 0.035;
      core.rotation.y += reducedMotion ? 0 : 0.0018;
      renderer.render(scene, camera);
    };
    render();

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerleave', onPointerLeave);
      scene.traverse(object => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach(material => material.dispose());
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div className={`operations-core ${webglAvailable ? '' : 'core-fallback'}`} ref={mountRef} aria-label="Three-dimensional illustration of a calm cloud infrastructure system" role="img">
    {!webglAvailable && <div className="fallback-core"><span /><i /><b /><em /></div>}
  </div>;
};
