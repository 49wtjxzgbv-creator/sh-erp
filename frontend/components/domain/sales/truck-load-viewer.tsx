'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { loadGlb, linearUnitScaleToMm } from '@/components/domain/files/step-3d-viewer';
import type { LoadPlanPlacedBox } from '@/lib/api-client/sales';

export interface TruckLoadViewerProps {
  truckDims: { lengthCm: number; widthCm: number; heightCm: number };
  placedBoxes: LoadPlanPlacedBox[];
  /** assemblyId -> downloadUrl of its attached .glb, when it has one (2026-10-28, "де є глб має бути видно 3д моделі що там") — boxes for assemblies missing here fall back to a plain colored block. */
  assemblyGlbUrls?: Record<string, string>;
  /**
   * Frames the camera tightly on just this assembly's own box(es) instead
   * of the whole truck's cargo (2026-10-28, "план завантаження мав на увазі
   * що самі глб файли в 3д переглядачі малі") — cargo-bbox framing already
   * helps a lightly-loaded truck, but when the packed items themselves are
   * spread across most of the truck's own length (confirmed live: 3 long
   * items placed end-to-end can span nearly the full envelope even at 1%
   * volume), the camera still has to pull back far enough to show
   * everything, leaving any ONE model small regardless. Set from the
   * legend in load-plan/page.tsx (click an item to focus it, click again
   * to go back to the full-load view); `undefined`/no match falls back to
   * framing the whole cargo exactly as before.
   */
  focusedAssemblyId?: string | null;
}

/**
 * Loads `glbUrl` and returns a group whose contents are re-centered on
 * their own bounding-box center and scaled UNIFORMLY (same factor on all
 * three axes) so the model's longest extent matches the longest of
 * `targetCm`'s three dimensions. Deliberately NOT a per-axis stretch to
 * fill the packed slot exactly — the slot's length/width/height come from
 * a sorted-descending heuristic in computeGlbDimensions that has no fixed
 * correspondence to the model's native X/Y/Z, so a per-axis fit silently
 * squashes thin parts (a conveyor belt's thin profile, for example) into
 * an unrecognizable sliver. A uniform scale keeps the model's real
 * proportions intact — recognizable shape over exact bounding-box fill,
 * since this is a visual aid, not an engineering drawing (2026-10-28,
 * "не видно в фурі глб моделей виробів як вони складені" — the per-axis
 * version was technically present but visually illegible). Mirrors the
 * same `loadGlb` + `Box3` + `linearUnitScaleToMm` normalization
 * `computeGlbDimensions`/`computeGlbVolume` already use. Returns `null` if
 * the file has no real geometry.
 */
async function loadGlbScaledToBox(
  glbUrl: string,
  targetCm: { lengthCm: number; widthCm: number; heightCm: number },
): Promise<THREE.Object3D | null> {
  const raw = await loadGlb(glbUrl);
  const box = new THREE.Box3().setFromObject(raw);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const rawMaxDim = Math.max(size.x, size.y, size.z);
  if (!(rawMaxDim > 0)) return null;

  const rawToCm = linearUnitScaleToMm(rawMaxDim) / 10;
  const targetMaxDim = Math.max(targetCm.lengthCm, targetCm.widthCm, targetCm.heightCm);
  const scale = targetMaxDim / (rawMaxDim * rawToCm);

  const wrapper = new THREE.Group();
  raw.position.sub(center);
  wrapper.add(raw);
  wrapper.scale.setScalar(scale);
  return wrapper;
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
export function TruckLoadViewer({ truckDims, placedBoxes, assemblyGlbUrls, focusedAssemblyId }: TruckLoadViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf3f4f6);

    const maxDim = Math.max(truckDims.lengthCm, truckDims.widthCm, truckDims.heightCm) || 1;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
    dirLight.position.set(maxDim, maxDim, maxDim);
    scene.add(dirLight);

    // Frame the camera on the actual LOADED CARGO, not the full (often
    // mostly-empty) truck envelope — a lightly-loaded truck used to leave
    // every item a tiny sliver in the middle of the frame, barely large
    // enough to tell a real model apart from a plain block (2026-10-28,
    // "неипоказує там реальні глб вироби просто прямокутники"). Falls back
    // to the truck's own envelope when there's nothing loaded yet.
    const truckCenterLocal = new THREE.Vector3(truckDims.lengthCm / 2, truckDims.heightCm / 2, truckDims.widthCm / 2);
    // A focused assembly narrows the framing box down to just ITS OWN
    // placed boxes — falls through to the full-cargo box below when
    // nothing is focused, or when the focused id isn't actually in this
    // truck (e.g. it got moved to another truck while focused).
    const focusedBoxes = focusedAssemblyId ? placedBoxes.filter((b) => b.assemblyId === focusedAssemblyId) : [];
    const framingBoxes = focusedBoxes.length > 0 ? focusedBoxes : placedBoxes;
    const cargoBox = new THREE.Box3();
    for (const box of framingBoxes) {
      cargoBox.expandByPoint(new THREE.Vector3(box.x, box.z, box.y));
      cargoBox.expandByPoint(new THREE.Vector3(box.x + box.lengthCm, box.z + box.heightCm, box.y + box.widthCm));
    }
    const hasCargo = framingBoxes.length > 0;
    const cargoCenterLocal = hasCargo ? cargoBox.getCenter(new THREE.Vector3()) : truckCenterLocal.clone();
    const cargoSize = hasCargo ? cargoBox.getSize(new THREE.Vector3()) : new THREE.Vector3(truckDims.lengthCm, truckDims.heightCm, truckDims.widthCm);
    const cargoMaxDim = Math.max(cargoSize.x, cargoSize.y, cargoSize.z, 1);
    // Truck-local coords recenter on the truck's own middle (see `group`
    // below) — the camera target has to be expressed in that same
    // recentered world space, not raw truck-local coordinates.
    const targetWorld = cargoCenterLocal.clone().sub(truckCenterLocal);

    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;
    const camera = new THREE.PerspectiveCamera(45, width / height, maxDim / 1000, maxDim * 100);
    camera.position.set(targetWorld.x + cargoMaxDim * 1.3, targetWorld.y + cargoMaxDim * 1.1, targetWorld.z + cargoMaxDim * 1.3);
    camera.lookAt(targetWorld);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.copy(targetWorld);

    // Truck-local coords have their origin at a floor corner; re-centering
    // the whole group on the truck's own geometric center (same framing
    // idiom as Step3DViewer's mountScene) keeps OrbitControls' target at
    // world-origin meaningful regardless of truck size.
    const group = new THREE.Group();
    group.position.set(-truckDims.lengthCm / 2, -truckDims.heightCm / 2, -truckDims.widthCm / 2);
    scene.add(group);

    // Semi-transparent cargo body (2026-10-28, "короб завантаження має бути
    // напівпрозорим") — a real solid mesh, not just edges, so the truck
    // reads as an actual container while still letting what's loaded
    // inside show through.
    const truckGeometry = new THREE.BoxGeometry(truckDims.lengthCm, truckDims.heightCm, truckDims.widthCm);
    const truckMaterial = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const truckMesh = new THREE.Mesh(truckGeometry, truckMaterial);
    truckMesh.position.set(truckDims.lengthCm / 2, truckDims.heightCm / 2, truckDims.widthCm / 2);
    group.add(truckMesh);
    const truckOutline = new THREE.LineSegments(new THREE.EdgesGeometry(truckGeometry), new THREE.LineBasicMaterial({ color: 0x334155 }));
    truckOutline.position.copy(truckMesh.position);
    group.add(truckOutline);

    for (const box of placedBoxes) {
      const slotPosition = new THREE.Vector3(box.x + box.lengthCm / 2, box.z + box.heightCm / 2, box.y + box.widthCm / 2);
      const geometry = new THREE.BoxGeometry(box.lengthCm, box.heightCm, box.widthCm);
      const boxEdges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry),
        new THREE.LineBasicMaterial({ color: 0x1e293b, transparent: true, opacity: 0.25 }),
      );
      boxEdges.position.copy(slotPosition);
      group.add(boxEdges);

      const glbUrl = assemblyGlbUrls?.[box.assemblyId];
      if (glbUrl) {
        // Real geometry (2026-10-28, "де є глб має бути видно 3д моделі що
        // там") loads async — the plain colored block below is swapped in
        // immediately so the scene never shows an empty slot while waiting,
        // then replaced once (if) the model resolves.
        const placeholderGeometry = new THREE.BoxGeometry(box.lengthCm, box.heightCm, box.widthCm);
        const placeholderMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(colorForAssembly(box.assemblyId)), transparent: true, opacity: 0.5 });
        const placeholder = new THREE.Mesh(placeholderGeometry, placeholderMaterial);
        placeholder.position.copy(slotPosition);
        group.add(placeholder);

        loadGlbScaledToBox(glbUrl, { lengthCm: box.lengthCm, widthCm: box.widthCm, heightCm: box.heightCm })
          .then((model) => {
            if (!model) return;
            if (cancelled) {
              // Resolved after the viewer unmounted (e.g. the user switched
              // trucks mid-load) — never got added to the (now-disposed)
              // scene, so its own GPU resources need disposing here instead
              // of via the effect's own cleanup traversal.
              model.traverse((o) => {
                if (o instanceof THREE.Mesh) {
                  o.geometry.dispose();
                  for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
                }
              });
              return;
            }
            group.remove(placeholder);
            placeholderGeometry.dispose();
            placeholderMaterial.dispose();
            model.position.copy(slotPosition);
            group.add(model);
          })
          .catch(() => {
            // Leave the colored placeholder in place — a broken/unreadable
            // GLB shouldn't blank out that slot entirely.
          });
      } else {
        const material = new THREE.MeshStandardMaterial({ color: new THREE.Color(colorForAssembly(box.assemblyId)) });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.copy(slotPosition);
        group.add(mesh);
        continue;
      }
      geometry.dispose();
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
      cancelled = true;
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
  }, [truckDims, placedBoxes, assemblyGlbUrls, focusedAssemblyId]);

  return <div ref={containerRef} className="h-full min-h-[420px] w-full" />;
}
