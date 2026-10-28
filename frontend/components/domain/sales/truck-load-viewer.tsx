'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { LoadPlanPlacedBox } from '@/lib/api-client/sales';

export interface TruckLoadViewerProps {
  truckDims: { lengthCm: number; widthCm: number; heightCm: number };
  placedBoxes: LoadPlanPlacedBox[];
}

/** Deterministic color per assemblyId (same product keeps the same color across trucks/renders) — also used by the legend in load-plan/page.tsx, so exported. */
export function colorForAssembly(assemblyId: string): string {
  let hash = 0;
  for (let i = 0; i < assemblyId.length; i++) hash = (hash * 31 + assemblyId.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return `hsl(${hue}, 55%, 55%)`;
}

/**
 * Load-plan module (2026-10-28) — renders one truck's 3D layout: boxes are
 * given by the backend (LoadPlanService#get, load-plan-packing.ts) in
 * truck-local coordinates, origin at the floor's front-left-bottom corner,
 * X = along truck length, Y = along truck width (floor), Z = stacking
 * height. No GLTFLoader here — unlike Step3DViewer (frontend/components/
 * domain/files/step-3d-viewer.tsx), there's no file to load, just
 * programmatic BoxGeometry — but the manual mountScene-style setup
 * (scene/lights/camera/renderer/OrbitControls/ResizeObserver/dispose) is
 * the same hand-rolled three.js pattern, reused deliberately rather than
 * introducing react-three-fiber (not used anywhere else in this project).
 */
export function TruckLoadViewer({ truckDims, placedBoxes }: TruckLoadViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf3f4f6);

    const maxDim = Math.max(truckDims.lengthCm, truckDims.widthCm, truckDims.heightCm) || 1;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
    dirLight.position.set(maxDim, maxDim, maxDim);
    scene.add(dirLight);

    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;
    const camera = new THREE.PerspectiveCamera(45, width / height, maxDim / 1000, maxDim * 100);
    camera.position.set(maxDim * 1.3, maxDim * 1.1, maxDim * 1.3);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 0, 0);

    // Truck-local coords have their origin at a floor corner; re-centering
    // the whole group on the truck's own geometric center (same framing
    // idiom as Step3DViewer's mountScene) keeps OrbitControls' target at
    // world-origin meaningful regardless of truck size.
    const group = new THREE.Group();
    group.position.set(-truckDims.lengthCm / 2, -truckDims.heightCm / 2, -truckDims.widthCm / 2);
    scene.add(group);

    const truckGeometry = new THREE.BoxGeometry(truckDims.lengthCm, truckDims.heightCm, truckDims.widthCm);
    const truckOutline = new THREE.LineSegments(new THREE.EdgesGeometry(truckGeometry), new THREE.LineBasicMaterial({ color: 0x334155 }));
    truckOutline.position.set(truckDims.lengthCm / 2, truckDims.heightCm / 2, truckDims.widthCm / 2);
    group.add(truckOutline);
    truckGeometry.dispose();

    for (const box of placedBoxes) {
      const geometry = new THREE.BoxGeometry(box.lengthCm, box.heightCm, box.widthCm);
      const material = new THREE.MeshStandardMaterial({ color: new THREE.Color(colorForAssembly(box.assemblyId)) });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(box.x + box.lengthCm / 2, box.z + box.heightCm / 2, box.y + box.widthCm / 2);
      group.add(mesh);
      const boxEdges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry),
        new THREE.LineBasicMaterial({ color: 0x1e293b, transparent: true, opacity: 0.25 }),
      );
      boxEdges.position.copy(mesh.position);
      group.add(boxEdges);
    }

    let animationFrame: number;
    function animate() {
      animationFrame = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    const resizeObserver = new ResizeObserver(() => {
      const w = container.clientWidth || 1;
      const h = container.clientHeight || 1;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
          o.geometry.dispose();
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) m.dispose();
        }
      });
    };
  }, [truckDims, placedBoxes]);

  return <div ref={containerRef} className="h-full min-h-[320px] w-full" />;
}
