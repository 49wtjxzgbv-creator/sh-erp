'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { loadGlb, linearUnitScaleToMm } from '@/components/domain/files/step-3d-viewer';
import type { LoadPlanPlacedBox, LoadPlanStrapPlan } from '@/lib/api-client/sales';

export interface TruckLoadViewerProps {
  truckDims: { lengthCm: number; widthCm: number; heightCm: number };
  placedBoxes: LoadPlanPlacedBox[];
  /**
   * Where/how many tie-down straps to draw over the load (2026-10-28,
   * "потрібно щоб враховувало стропи ремені як привязувати в фурі") —
   * each position becomes an upside-down-U line from the floor on one side,
   * over the stack, down to the floor on the other side, the same path a
   * real strap takes from one anchor rail to the opposite one. Skipped
   * entirely in focus mode (see `focusedAssemblyId` below) — a stray strap
   * line floating over a single close-up item is noise, not signal, at
   * that zoom level.
   */
  strapPlan?: LoadPlanStrapPlan | null;
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

const AXIS_UNIT_VECTORS: Record<'x' | 'y' | 'z', THREE.Vector3> = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};

/**
 * Loads `glbUrl` and returns a group whose contents are re-centered on
 * their own bounding-box center, ROTATED so the model's native longest/
 * middle/shortest axes land on world length/width/height, and scaled
 * UNIFORMLY (same factor on all three, once aligned) to match `targetCm`.
 *
 * The box slot's own length/width/height ALREADY come from sorting the
 * model's three measured extents descending (computeGlbDimensions) — but
 * until this fix, the model itself kept rendering in its own native
 * (unrotated) axis order, with only a single uniform scale applied. For a
 * model whose native axes already happen to run longest/middle/shortest
 * in X/Y/Z order (like a conveyor beam, X already its long axis) that's
 * invisible; for one where they don't (e.g. native Y, "up" in the
 * original file, is actually the model's SECOND-longest extent, not its
 * shortest), the model would overflow the box along one world axis and
 * visibly float inside it on another — exactly what inspecting this live
 * showed (2026-10-28, "всередині коробки фури є коробки виробів і вони
 * більші набагато за глб файли виробів"). Aligning first makes the
 * model's own measured extents coincide with the box's length/width/
 * height on the SAME world axes the box itself is drawn on, so a single
 * uniform scale afterward fits all three dimensions at once, not just the
 * longest. Still deliberately uniform, not a per-axis stretch — see
 * `loadGlbScaledToBox`'s own earlier note on why a non-uniform stretch
 * was rejected (squashes thin parts unrecognizably); this fixes the
 * axis-ORDER mismatch, not the "faithful stretch vs. true proportions"
 * tradeoff, which stands. Mirrors the same `loadGlb` + `Box3` +
 * `linearUnitScaleToMm` normalization `computeGlbDimensions`/
 * `computeGlbVolume` already use. Returns `null` if the file has no real
 * geometry.
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

  // Same sort computeGlbDimensions itself uses to assign length/width/
  // height — reapplied here against the native AXES (not just the bare
  // numbers) so we know which native axis is this model's longest,
  // middle, and shortest extent.
  const byDescendingSize = (['x', 'y', 'z'] as const).map((axis) => ({ axis, size: size[axis] })).sort((a, b) => b.size - a.size);
  const [longest, middle, shortest] = byDescendingSize;
  // World convention this whole viewer already draws boxes in (see the
  // packed-box loop below): X = length, Y = height (up), Z = width.
  const permutation = new THREE.Matrix4().set(
    ...AXIS_UNIT_VECTORS[longest.axis].toArray(), 0,
    ...AXIS_UNIT_VECTORS[shortest.axis].toArray(), 0,
    ...AXIS_UNIT_VECTORS[middle.axis].toArray(), 0,
    0, 0, 0, 1,
  );
  const permutationQuaternion = new THREE.Quaternion();
  const permutationScale = new THREE.Vector3();
  const unusedPosition = new THREE.Vector3();
  // `decompose` handles both a proper rotation (determinant +1 — a cyclic
  // axis swap) and an improper one (determinant -1 — swapping exactly two
  // axes) by folding the sign into `permutationScale`, so this works
  // regardless of which permutation this particular model needs.
  permutation.decompose(unusedPosition, permutationQuaternion, permutationScale);

  const wrapper = new THREE.Group();
  raw.position.sub(center);
  wrapper.add(raw);
  wrapper.quaternion.copy(permutationQuaternion);
  // `scale` alone only converts "native units already multiplied by
  // rawToCm" to cm — applied directly to the RAW geometry (still in
  // native units, meters or mm, never multiplied by rawToCm anywhere
  // else), it silently dropped that unit conversion. For a meters-native
  // file (rawToCm=100) this rendered everything 100x too small — easy to
  // miss at the whole-truck overview (a tiny mis-scaled model deep inside
  // a huge truck just reads as "small, like everything else here") but
  // unmistakable once focus mode (above) zoomed the camera in based on
  // the CORRECTLY-sized box slot while the model inside stayed 100x too
  // small (2026-10-28, confirmed live: "модель в сотні разів менше чим
  // короб" — measured directly via a bounding-box diagnostic: a model
  // whose real size should've been ~429cm rendered at ~4.3cm).
  wrapper.scale.copy(permutationScale).multiplyScalar(scale * rawToCm);
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
export function TruckLoadViewer({ truckDims, placedBoxes, assemblyGlbUrls, focusedAssemblyId, strapPlan }: TruckLoadViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;

    // Many placed boxes share the same assembly's glb, so without caching
    // this reloaded+reparsed the identical file once per box — freezing the
    // page on trucks with lots of boxes. Scoped to this effect run, not
    // module-level, so it never outlives the scene it was built for. The
    // resolved template is never added to the scene itself — its meshes are
    // only read from (see the instanced-rendering block below), so it's
    // returned as-is rather than cloned.
    const scaledModelCache = new Map<string, Promise<THREE.Object3D | null>>();
    function loadGlbScaledToBoxCached(glbUrl: string, targetCm: { lengthCm: number; widthCm: number; heightCm: number }): Promise<THREE.Object3D | null> {
      // Dims included in case two different assemblies ever share one glb file.
      const cacheKey = `${glbUrl}|${targetCm.lengthCm}x${targetCm.widthCm}x${targetCm.heightCm}`;
      let cached = scaledModelCache.get(cacheKey);
      if (!cached) {
        cached = loadGlbScaledToBox(glbUrl, targetCm);
        scaledModelCache.set(cacheKey, cached);
      }
      return cached;
    }

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
    // A focused assembly narrows the framing box down to just ONE of its
    // own placed copies — not every copy's combined span, which for an
    // assembly packed in several separate spots (its own boxes didn't all
    // fit on the same shelf/row) could still stretch most of the truck's
    // length and defeat the whole point of focusing (2026-10-28, found
    // live: an assembly placed once far down the truck and twice near the
    // front still framed as a long sliver). Falls through to the
    // full-cargo box below when nothing is focused, or when the focused id
    // isn't actually in this truck (e.g. it got moved to another truck
    // while focused).
    const focusedBox = focusedAssemblyId ? placedBoxes.find((b) => b.assemblyId === focusedAssemblyId) : undefined;
    const framingBoxes = focusedBox ? [focusedBox] : placedBoxes;
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
    // inside show through. Skipped entirely in focus mode (2026-10-28,
    // "не розумію тоді чому в зд моделі фури ті коробки набагато більші за
    // самі вироби" — confirmed live: what read as "a huge box around the
    // item" was actually this same huge wall, filling the frame because a
    // focused item sitting flush against the truck's own side puts the
    // tight close-up camera right up against that wall too. There's
    // nothing useful this translucent shell adds at that zoom level, only
    // a giant pale panel competing with the one item the user asked to see
    // — the item's own boxEdges below are enough to orient it).
    const truckGeometry = new THREE.BoxGeometry(truckDims.lengthCm, truckDims.heightCm, truckDims.widthCm);
    if (!focusedBox) {
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
    }
    const truckOutline = new THREE.LineSegments(
      new THREE.EdgesGeometry(truckGeometry),
      new THREE.LineBasicMaterial({ color: 0x334155, transparent: true, opacity: focusedBox ? 0.15 : 1 }),
    );
    truckOutline.position.set(truckDims.lengthCm / 2, truckDims.heightCm / 2, truckDims.widthCm / 2);
    group.add(truckOutline);
    // `EdgesGeometry` derives its own geometry rather than referencing
    // `truckGeometry` — when the solid mesh above was skipped (focus
    // mode), nothing else owns `truckGeometry` for the cleanup traversal
    // below to find and dispose.
    if (focusedBox) truckGeometry.dispose();

    // Boxes sharing the same assembly+dims are batched here instead of
    // handled individually below — a truck can place the SAME assembly's
    // model dozens or hundreds of times, and loading no longer being the
    // bottleneck (the cache above) still left every one of those instances
    // adding its own full clone of the model's mesh hierarchy to the scene.
    // One real glb measured live here had 53 separate submeshes; placed 375
    // times that's ~19,875 individual WebGL draw calls every frame, which
    // is what was still freezing the page (confirmed: frame times over
    // 700ms even with fetch/parse already cached). Collected into groups
    // keyed the same way as the load cache so each group's placed instances
    // can be rendered as ONE THREE.InstancedMesh per submesh further down —
    // 53 draw calls total for that truck, regardless of how many boxes
    // share the model.
    const glbGroups = new Map<
      string,
      { glbUrl: string; targetCm: { lengthCm: number; widthCm: number; heightCm: number }; slotPositions: THREE.Vector3[]; placeholders: { geometry: THREE.BoxGeometry; material: THREE.MeshStandardMaterial; mesh: THREE.Mesh }[] }
    >();

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
        const targetCm = { lengthCm: box.lengthCm, widthCm: box.widthCm, heightCm: box.heightCm };
        const cacheKey = `${glbUrl}|${targetCm.lengthCm}x${targetCm.widthCm}x${targetCm.heightCm}`;
        let entry = glbGroups.get(cacheKey);
        if (!entry) {
          entry = { glbUrl, targetCm, slotPositions: [], placeholders: [] };
          glbGroups.set(cacheKey, entry);
        }
        entry.slotPositions.push(slotPosition);

        // Real geometry (2026-10-28, "де є глб має бути видно 3д моделі що
        // там") loads async — a plain colored block per instance is shown
        // immediately so the scene never shows empty slots while waiting,
        // then the whole group's placeholders are swapped for the
        // instanced model together once (if) it resolves.
        const placeholderGeometry = new THREE.BoxGeometry(box.lengthCm, box.heightCm, box.widthCm);
        const placeholderMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(colorForAssembly(box.assemblyId)), transparent: true, opacity: 0.5 });
        const placeholder = new THREE.Mesh(placeholderGeometry, placeholderMaterial);
        placeholder.position.copy(slotPosition);
        group.add(placeholder);
        entry.placeholders.push({ geometry: placeholderGeometry, material: placeholderMaterial, mesh: placeholder });
      } else {
        const material = new THREE.MeshStandardMaterial({ color: new THREE.Color(colorForAssembly(box.assemblyId)) });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.copy(slotPosition);
        group.add(mesh);
        continue;
      }
      geometry.dispose();
    }

    for (const entry of glbGroups.values()) {
      loadGlbScaledToBoxCached(entry.glbUrl, entry.targetCm)
        .then((template) => {
          if (cancelled) {
            // The viewer unmounted before this resolved (e.g. the user
            // switched trucks mid-load) — nothing from this group was ever
            // added to the (now-disposed) scene, including the template
            // itself (only read from below, never added directly), so
            // there's nothing here that needs disposing.
            return;
          }
          for (const { geometry, material, mesh } of entry.placeholders) {
            group.remove(mesh);
            geometry.dispose();
            material.dispose();
          }
          if (!template) return;

          // `template` itself is a throwaway wrapper never added to the
          // scene — each submesh's `matrixWorld`, computed here with the
          // wrapper still at the origin, is exactly its center/align/scale
          // transform (what `loadGlbScaledToBox` built it for) with no
          // per-instance placement folded in yet, so prepending each box's
          // own translation below reproduces precisely the placement the
          // old one-clone-per-box code did, just without cloning.
          template.updateMatrixWorld(true);
          const templateMeshes: THREE.Mesh[] = [];
          template.traverse((o) => {
            if (o instanceof THREE.Mesh) templateMeshes.push(o);
          });
          const matrix = new THREE.Matrix4();
          for (const mesh of templateMeshes) {
            const instanced = new THREE.InstancedMesh(mesh.geometry, mesh.material, entry.slotPositions.length);
            entry.slotPositions.forEach((pos, i) => {
              matrix.makeTranslation(pos.x, pos.y, pos.z).multiply(mesh.matrixWorld);
              instanced.setMatrixAt(i, matrix);
            });
            instanced.instanceMatrix.needsUpdate = true;
            group.add(instanced);
          }
        })
        .catch(() => {
          // Leave the colored placeholders in place — a broken/unreadable
          // GLB shouldn't blank out those slots entirely.
        });
    }

    // Tie-down straps (2026-10-28, "потрібно щоб враховувало стропи ремені
    // як привязувати в фурі") — one curved line per recommended strap
    // position, from the floor on one side of the truck, over the stack,
    // down to the floor on the other side. A sharp 4-point rectangle here
    // read as a rigid rod, not webbing ("вони ж з мотузки і не так
    // натягуються" — 2026-10-28): a real strap pulled taut still bends
    // smoothly around the load's top corners rather than turning a crisp
    // right angle, so this runs a `CatmullRomCurve3` through rounded-corner
    // control points instead of a straight-edged path. Skipped in focus
    // mode: see this prop's own header comment.
    if (strapPlan && !focusedBox) {
      const loadHeightCm = placedBoxes.length > 0 ? Math.max(...placedBoxes.map((b) => b.z + b.heightCm)) : 0;
      const strapTopCm = loadHeightCm + Math.max(truckDims.heightCm * 0.03, 3);
      const cornerRoundingCm = Math.min(strapTopCm, truckDims.widthCm) * 0.18;
      const strapMaterial = new THREE.LineBasicMaterial({ color: 0xea580c });
      for (const x of strapPlan.positionsCm) {
        const curve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(x, 0, 0),
          new THREE.Vector3(x, strapTopCm * 0.55, cornerRoundingCm * 0.25),
          new THREE.Vector3(x, strapTopCm, cornerRoundingCm),
          new THREE.Vector3(x, strapTopCm, truckDims.widthCm - cornerRoundingCm),
          new THREE.Vector3(x, strapTopCm * 0.55, truckDims.widthCm - cornerRoundingCm * 0.25),
          new THREE.Vector3(x, 0, truckDims.widthCm),
        ]);
        const strapLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(32)), strapMaterial);
        group.add(strapLine);
      }
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
        if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments || o instanceof THREE.Line) {
          o.geometry.dispose();
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) m.dispose();
        }
      });
    };
  }, [truckDims, placedBoxes, assemblyGlbUrls, focusedAssemblyId, strapPlan]);

  return <div ref={containerRef} className="h-full min-h-[420px] w-full" />;
}
