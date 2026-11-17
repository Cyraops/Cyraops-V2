"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

export type EarthPhase = "idle" | "listening" | "thinking" | "speaking" | "error";

interface VoiceEarthProps {
  phase: EarthPhase;
  /** Optional size override for the container. */
  className?: string;
  /** Timestamp of the last words the person said (drives a spin-up). */
  personPulseAt: number;
  /** Timestamp of the last word spoken aloud (drives the same spin-up). */
  speakPulseAt: number;
  onTap: () => void;
}

const AXIAL_TILT = (23.44 * Math.PI) / 180; // Earth's real tilt
const MOON_INCLINATION = (5.14 * Math.PI) / 180; // real orbital inclination
const MOON_DISTANCE = 2.35; // scaled down so it fits the canvas
const MOON_RADIUS = 0.27; // real ratio: 0.2725 of Earth

/**
 * A small, realistic Earth and Moon.
 *
 * Earth sits at its true 23.4° tilt and spins on that axis; the Moon orbits in
 * a plane inclined 5.1° to it, tidally locked so the same face stays towards
 * Earth. Idle, nothing moves. While listening, thinking or speaking, the spin
 * rises — and each word spoken, by the person or the assistant, adds a burst of
 * speed. It is decoration with real mechanics, all in one WebGL scene.
 */
export function VoiceEarth({ phase, personPulseAt, speakPulseAt, onTap, className }: VoiceEarthProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const phaseRef = useRef(phase);
  const personPulseRef = useRef(personPulseAt);
  const speakPulseRef = useRef(speakPulseAt);
  phaseRef.current = phase;
  personPulseRef.current = personPulseAt;
  speakPulseRef.current = speakPulseAt;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const container = canvas.parentElement;
    const size = () => Math.min(container?.clientWidth || 240, container?.clientHeight || 240);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setClearColor(0x000000, 0);
    renderer.setClearAlpha(0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 60);
    camera.position.set(0, 0.7, 7.4);
    camera.lookAt(0, 0, 0);

    const textureLoader = new THREE.TextureLoader();
    const earthMap = textureLoader.load("/textures/planets/earth_atmos_2048.jpg");
    const cloudMap = textureLoader.load("/textures/planets/earth_clouds_1024.png");
    const moonMap = textureLoader.load("/textures/planets/moon_1024.jpg");
    for (const texture of [earthMap, cloudMap, moonMap]) {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 8;
    }

    // Earth, tilted like the real one; spin happens around its own axis.
    const earthGroup = new THREE.Group();
    earthGroup.rotation.z = AXIAL_TILT;
    scene.add(earthGroup);

    const earth = new THREE.Mesh(
      new THREE.SphereGeometry(1, 64, 64),
      new THREE.MeshPhongMaterial({ map: earthMap, specular: 0x2f4c7d, shininess: 18 })
    );
    earthGroup.add(earth);

    // Clouds: a shell that drifts a little faster than the surface.
    const clouds = new THREE.Mesh(
      new THREE.SphereGeometry(1.012, 64, 64),
      new THREE.MeshPhongMaterial({ map: cloudMap, transparent: true, opacity: 0.6, depthWrite: false })
    );
    earthGroup.add(clouds);

    // A faint atmospheric rim.
    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(1.07, 48, 48),
      new THREE.MeshBasicMaterial({ color: 0x6f9dff, transparent: true, opacity: 0.17, side: THREE.BackSide })
    );
    earthGroup.add(atmosphere);

    // The Moon: its own orbit plane, inclined like the real one.
    const moonOrbit = new THREE.Group();
    moonOrbit.rotation.x = MOON_INCLINATION;
    scene.add(moonOrbit);

    const moon = new THREE.Mesh(
      new THREE.SphereGeometry(MOON_RADIUS, 48, 48),
      new THREE.MeshPhongMaterial({ map: moonMap, specular: 0x262626, shininess: 8 })
    );
    moon.position.set(MOON_DISTANCE, 0, 0);
    moonOrbit.add(moon);

    // Sunlight from one direction: half the Earth is day, half is night.
    const sun = new THREE.DirectionalLight(0xfff8ef, 3.0);
    sun.position.set(-4.4, 1.7, 4.6);
    scene.add(sun);
    scene.add(new THREE.AmbientLight(0x3d4f7d, 1.05));

    // A quiet starfield behind the pair.
    const starGeometry = new THREE.BufferGeometry();
    const starPositions = new Float32Array(900 * 3);
    for (let i = 0; i < 900; i += 1) {
      const radius = 14 + Math.random() * 18;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      starPositions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      starPositions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      starPositions[i * 3 + 2] = radius * Math.cos(phi);
    }
    starGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
    const stars = new THREE.Points(
      starGeometry,
      new THREE.PointsMaterial({ color: 0xcdd6ff, size: 0.06, sizeAttenuation: true, transparent: true, opacity: 0.9 })
    );
    scene.add(stars);

    let disposed = false;
    let raf = 0;
    const moonWorld = new THREE.Vector3();
    let speed = 0; // current spin, eased towards the target
    let earthSpin = Math.random() * Math.PI * 2;
    let orbitAngle = Math.random() * Math.PI * 2;
    let last = performance.now();

    const frame = (now: number) => {
      if (disposed) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;


      // How fast things turn: idle is still, speech adds motion.
      const phase = phaseRef.current;
      let target = 0;
      if (phase === "listening") target = 0.45 + (now - personPulseRef.current < 1400 ? 1.7 : 0);
      if (phase === "thinking") target = 2.1;
      if (phase === "speaking") target = 2.4 + (now - speakPulseRef.current < 320 ? 2.0 : 0);
      if (phase === "error") target = 0;
      speed += (target - speed) * Math.min(1, dt * 3.5);

      // Earth spins on its tilted axis; clouds drift a touch faster.
      earthSpin += speed * dt * 0.85;
      earth.rotation.y = earthSpin;
      clouds.rotation.y = earthSpin * 1.12;

      // The Moon revolves, faster as the conversation heats up, and stays
      // tidally locked: the same face keeps pointing at Earth.
      orbitAngle += (0.05 + speed * 0.5) * dt;
      moonOrbit.rotation.y = orbitAngle;
      moon.rotation.y = -orbitAngle + Math.PI; // one face always to Earth

      /**
       * Earth stays dead centre; the Moon orbits around it.
       *
       * Framing the pair instead moved Earth off-centre whenever the Moon was on
       * the right, which read worse than the Moon being off to one side.
       */
      const pointerX = (pointerRef.current.x - 0.5) * 0.4;
      camera.position.x += (pointerX - camera.position.x) * Math.min(1, dt * 2);
      const pointerY = (pointerRef.current.y - 0.5) * 0.3;
      camera.position.y += (0.7 + pointerY - camera.position.y) * Math.min(1, dt * 2.5);
      camera.lookAt(0, 0, 0);

      renderer.render(scene, camera);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    // Shared pointer state for the parallax.
    const pointerRef = { current: { x: 0.5, y: 0.5 } };
    const onPointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointerRef.current.x = rect.width ? (event.clientX - rect.left) / rect.width : 0.5;
      pointerRef.current.y = rect.height ? (event.clientY - rect.top) / rect.height : 0.5;
    };
    window.addEventListener("pointermove", onPointerMove);

    const resize = () => {
      const side = size();
      renderer.setSize(side, side, false);
      camera.aspect = 1;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    if (container) observer.observe(container);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onPointerMove);
      observer.disconnect();
      earth.geometry.dispose();
      clouds.geometry.dispose();
      atmosphere.geometry.dispose();
      moon.geometry.dispose();
      starGeometry.dispose();
      (earth.material as THREE.Material).dispose();
      (clouds.material as THREE.Material).dispose();
      (atmosphere.material as THREE.Material).dispose();
      (moon.material as THREE.Material).dispose();
      (stars.material as THREE.Material).dispose();
      earthMap.dispose();
      cloudMap.dispose();
      moonMap.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <div className={`relative cursor-pointer select-none ${className ?? "h-56 w-56"}`} role="button" aria-label="Voice orb" tabIndex={0}
      onClick={onTap} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onTap(); }}>
      <canvas ref={canvasRef} className="h-full w-full" style={{ background: "transparent" }} aria-hidden />
    </div>
  );
}
