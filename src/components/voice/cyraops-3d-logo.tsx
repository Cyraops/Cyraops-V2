"use client";

import React, { useEffect, useRef } from "react";
import * as THREE from "three";

export type VoiceLogoState =
  | "IDLE"
  | "LISTENING"
  | "USER_SPEAKING"
  | "THINKING"
  | "ASSISTANT_SPEAKING"
  | "INTERRUPTED"
  | "MUTED"
  | "ENDED";

interface Cyraops3DLogoProps {
  state?: VoiceLogoState;
  amplitude?: number; // Normalized 0.0 - 1.0 from real Web Audio API
  size?: "sm" | "md" | "lg";
  className?: string;
  interactive?: boolean;
}

export function Cyraops3DLogo({
  state = "IDLE",
  amplitude = 0,
  size = "md",
  className = "",
  interactive = false,
}: Cyraops3DLogoProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);
  const amplitudeRef = useRef(amplitude);

  // Dimensions
  const pxSize = size === "sm" ? 34 : size === "md" ? 80 : 220;

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    amplitudeRef.current = amplitude;
  }, [amplitude]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Check prefers-reduced-motion
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // 1. Scene & Camera
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
    camera.position.set(0, 0, 4.4);

    // 2. Renderer
    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.setSize(pxSize, pxSize);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;

    container.innerHTML = "";
    container.appendChild(renderer.domElement);

    // 3. Materials
    // Upper / outer ribbon material (translucent sage green with clearcoat)
    const upperMaterial = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color("#95b596"),
      emissive: new THREE.Color("#2a522c"),
      emissiveIntensity: 0.1,
      roughness: 0.28,
      metalness: 0.08,
      transmission: 0.45,
      thickness: 0.6,
      clearcoat: 0.6,
      clearcoatRoughness: 0.2,
      ior: 1.45,
      transparent: true,
      opacity: 0.96,
      side: THREE.DoubleSide,
    });

    // Lower / inner ribbon material (deeper olive forest green fold)
    const lowerMaterial = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color("#4a6a4c"),
      emissive: new THREE.Color("#18381a"),
      emissiveIntensity: 0.1,
      roughness: 0.35,
      metalness: 0.05,
      transmission: 0.35,
      thickness: 0.8,
      clearcoat: 0.4,
      clearcoatRoughness: 0.3,
      ior: 1.45,
      transparent: true,
      opacity: 0.98,
      side: THREE.DoubleSide,
    });

    // 4. Geometry Generation for Cyraops "C"
    // Create the outer sweeping curved ribbon (top-right down to mid-left)
    const upperShape = new THREE.Shape();
    upperShape.moveTo(0.52, 0.32);
    upperShape.bezierCurveTo(0.58, 0.42, 0.48, 0.55, 0.38, 0.62);
    upperShape.bezierCurveTo(0.15, 0.82, -0.35, 0.85, -0.68, 0.55);
    upperShape.bezierCurveTo(-0.92, 0.32, -0.96, -0.15, -0.80, -0.50);
    upperShape.bezierCurveTo(-0.62, -0.35, -0.58, -0.10, -0.50, 0.12);
    upperShape.bezierCurveTo(-0.40, 0.35, -0.15, 0.52, 0.18, 0.48);
    upperShape.bezierCurveTo(0.35, 0.45, 0.48, 0.36, 0.52, 0.32);
    upperShape.closePath();

    const extrudeSettingsUpper = {
      steps: 3,
      depth: 0.16,
      bevelEnabled: true,
      bevelThickness: 0.05,
      bevelSize: 0.04,
      bevelSegments: 4,
    };

    const upperGeometry = new THREE.ExtrudeGeometry(upperShape, extrudeSettingsUpper);
    upperGeometry.center();
    const upperMesh = new THREE.Mesh(upperGeometry, upperMaterial);
    upperMesh.position.set(-0.02, 0.08, 0.06);

    // Create the lower inner curved ribbon (sweeping from mid-left around bottom to bottom-right)
    const lowerShape = new THREE.Shape();
    lowerShape.moveTo(-0.78, -0.35);
    lowerShape.bezierCurveTo(-0.65, -0.68, -0.32, -0.88, 0.05, -0.88);
    lowerShape.bezierCurveTo(0.42, -0.88, 0.62, -0.65, 0.56, -0.36);
    lowerShape.bezierCurveTo(0.50, -0.25, 0.38, -0.28, 0.30, -0.38);
    lowerShape.bezierCurveTo(0.18, -0.55, -0.05, -0.62, -0.30, -0.52);
    lowerShape.bezierCurveTo(-0.52, -0.42, -0.65, -0.25, -0.78, -0.35);
    lowerShape.closePath();

    const extrudeSettingsLower = {
      steps: 3,
      depth: 0.15,
      bevelEnabled: true,
      bevelThickness: 0.05,
      bevelSize: 0.04,
      bevelSegments: 4,
    };

    const lowerGeometry = new THREE.ExtrudeGeometry(lowerShape, extrudeSettingsLower);
    lowerGeometry.center();
    const lowerMesh = new THREE.Mesh(lowerGeometry, lowerMaterial);
    lowerMesh.position.set(-0.03, -0.10, -0.05);

    // Group to hold the complete 3D Cyraops Logo
    const logoGroup = new THREE.Group();
    logoGroup.add(upperMesh);
    logoGroup.add(lowerMesh);
    logoGroup.rotation.z = 0;
    scene.add(logoGroup);

    // 5. Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
    keyLight.position.set(3, 4, 5);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xa5cda8, 1.6);
    fillLight.position.set(-4, -2, 3);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0x73b879, 1.8);
    rimLight.position.set(1, -3, -3);
    scene.add(rimLight);

    const centralGlow = new THREE.PointLight(0x6ee791, 0.4, 4);
    centralGlow.position.set(0, 0, 0.5);
    scene.add(centralGlow);

    // 6. Animation Loop with Audio Reactivity
    let animationFrameId: number;
    let clock = new THREE.Clock();
    let currentScale = 1.0;
    let currentEmissive = 0.1;

    let isVisible = true;
    const observer = new IntersectionObserver(([entry]) => {
      isVisible = entry.isIntersecting;
    });
    observer.observe(container);

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      if (!isVisible) return;

      const elapsed = clock.getElapsedTime();
      const currentState = stateRef.current;
      const amp = Math.min(Math.max(amplitudeRef.current, 0), 1);

      if (prefersReducedMotion) {
        renderer.render(scene, camera);
        return;
      }

      // Base idle subtle floating
      let targetRotY = Math.sin(elapsed * 1.2) * 0.12;
      let targetRotX = Math.cos(elapsed * 1.0) * 0.08;
      let targetScale = 1.0;
      let targetEmissive = 0.12;
      let glowColor = new THREE.Color("#2a522c");

      switch (currentState) {
        case "IDLE":
          targetScale = 1.0 + Math.sin(elapsed * 2.0) * 0.015;
          targetEmissive = 0.1;
          break;

        case "LISTENING":
          // Subtle breathing pulse, attentive ready posture
          targetScale = 1.03 + Math.sin(elapsed * 4.0) * 0.04;
          targetEmissive = 0.25;
          glowColor = new THREE.Color("#3b8245");
          targetRotY = Math.sin(elapsed * 2.0) * 0.15;
          break;

        case "USER_SPEAKING":
          // Reactive to real-time mic amplitude
          targetScale = 1.0 + amp * 0.35;
          targetEmissive = 0.3 + amp * 0.7;
          targetRotY = Math.sin(elapsed * 5.0) * (0.1 + amp * 0.2);
          glowColor = new THREE.Color("#34d399"); // Bright emerald
          break;

        case "THINKING":
          // Orbiting rotation indicating DeepSeek reasoning
          targetRotY = elapsed * 3.5;
          targetRotX = Math.sin(elapsed * 2.5) * 0.2;
          targetScale = 1.04 + Math.sin(elapsed * 6.0) * 0.03;
          targetEmissive = 0.45 + Math.sin(elapsed * 5.0) * 0.25;
          glowColor = new THREE.Color("#60a5fa"); // Soft thinking cyan-blue
          break;

        case "ASSISTANT_SPEAKING":
          // Reactive to real-time TTS audio playback amplitude
          targetScale = 1.02 + amp * 0.32;
          targetEmissive = 0.4 + amp * 0.6;
          targetRotY = Math.sin(elapsed * 3.0) * 0.2;
          glowColor = new THREE.Color("#4ade80"); // Vibrant green
          break;

        case "INTERRUPTED":
          // Snaps back immediately to listening
          targetScale = 0.98;
          targetEmissive = 0.3;
          targetRotY = 0;
          break;

        case "MUTED":
          targetScale = 0.95;
          targetEmissive = 0.02;
          glowColor = new THREE.Color("#4b5563");
          targetRotX = 0;
          targetRotY = 0;
          break;

        case "ENDED":
          targetScale = 1.0;
          targetEmissive = 0.05;
          break;
      }

      // Smooth interpolation for jitter-free animation
      currentScale += (targetScale - currentScale) * 0.2;
      currentEmissive += (targetEmissive - currentEmissive) * 0.2;

      logoGroup.scale.set(currentScale, currentScale, currentScale);
      logoGroup.rotation.y += (targetRotY - logoGroup.rotation.y) * 0.15;
      logoGroup.rotation.x += (targetRotX - logoGroup.rotation.x) * 0.15;

      upperMaterial.emissive.lerp(glowColor, 0.2);
      upperMaterial.emissiveIntensity = currentEmissive;
      lowerMaterial.emissive.lerp(glowColor, 0.2);
      lowerMaterial.emissiveIntensity = currentEmissive * 0.7;
      centralGlow.intensity = currentEmissive * 1.5;

      renderer.render(scene, camera);
    };

    animate();

    // Cleanup
    return () => {
      cancelAnimationFrame(animationFrameId);
      observer.disconnect();
      if (container && renderer.domElement) {
        container.removeChild(renderer.domElement);
      }
      upperGeometry.dispose();
      lowerGeometry.dispose();
      upperMaterial.dispose();
      lowerMaterial.dispose();
      renderer.dispose();
    };
  }, [pxSize]);

  return (
    <div
      ref={containerRef}
      className={`relative flex items-center justify-center select-none overflow-hidden ${className}`}
      style={{ width: pxSize, height: pxSize }}
      aria-hidden="true"
    />
  );
}
