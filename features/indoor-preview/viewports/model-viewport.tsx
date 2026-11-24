"use client";

import { Html, OrbitControls, useGLTF } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { Component, Suspense, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { Color, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, OrthographicCamera, PerspectiveCamera, Vector3 } from "three";
import type { MapFrame, PreviewFloor, PreviewSample, PreviewTemplate, Vector3Tuple, ViewCommand } from "../preview-data";
import { EntranceBloom } from "./entrance-bloom";
import { RouteLightMotion } from "./route-light-motion";
import { TemplateLighting } from "./template-lighting";
import { useViewportGestures } from "./use-viewport-gestures";
import { pinClass, viewportClass, viewportStatusClass } from "./viewport-classes";

class ModelErrorBoundary extends Component<{ children: ReactNode }, { message: string }> {
  state = { message: "" };

  static getDerivedStateFromError(error: Error) {
    return {
      message: error.message.startsWith("GLB 缺少 ")
        ? error.message
        : "无法加载整栋 GLB，请检查本地预览资源",
    };
  }

  render() {
    return this.state.message
      ? <p className={`${viewportStatusClass} z-10`} role="alert">{this.state.message}</p>
      : this.props.children;
  }
}

function FloorModel({ modelUrl, floor, template, onReady }: {
  modelUrl: string;
  floor: PreviewFloor;
  template: PreviewTemplate;
  onReady: (key: string) => void;
}) {
  const { scene, animations } = useGLTF(modelUrl, false, false);
  const invalidate = useThree((state) => state.invalidate);
  const materials = useMemo(() => template.materials.map((material) => {
    const color = new Color().fromArray(material.color);
    if (material.unlit) return new MeshBasicMaterial({ name: material.name, color, toneMapped: false });
    return new MeshStandardMaterial({
      name: material.name,
      color,
      roughness: material.roughness,
      metalness: 0,
      ...(material.emission ? {
        emissive: new Color().fromArray(material.emission),
        emissiveIntensity: material.emissionStrength ?? 1,
      } : {}),
    });
  }), [template]);
  useEffect(() => () => {
    for (const material of materials) material.dispose();
  }, [materials]);

  const { model, detailMaterials } = useMemo(() => {
    const selected = scene.getObjectByName(floor.name)?.clone();
    const details = new Map<MeshStandardMaterial, MeshStandardMaterial>();
    selected?.traverse((node) => {
      if (node instanceof Mesh) {
        if (node.userData.kind === "detail") {
          const original = node.material;
          const strength = template.detailEmissionStrengths?.[original.name];
          if (strength !== undefined && original instanceof MeshStandardMaterial) {
            if (!details.has(original)) {
              const variant = original.clone();
              variant.emissiveIntensity = strength;
              details.set(original, variant);
            }
            node.material = details.get(original);
          }
          return;
        }
        const key = node.userData.kind === "extent" ? "extent" : String(node.userData.sourceTypeId);
        const index = template.fidIndexes?.[node.userData.sourceFid] ?? template.indexes[key] ?? template.indexes.other;
        node.material = materials[index];
      }
    });
    return { model: selected, detailMaterials: details };
  }, [floor.name, materials, scene, template.detailEmissionStrengths, template.fidIndexes, template.indexes]);
  useEffect(() => () => {
    for (const material of detailMaterials.values()) material.dispose();
  }, [detailMaterials]);
  if (!model) throw new Error(`GLB 缺少 ${floor.name} 分组`);

  useLayoutEffect(() => {
    invalidate();
    onReady(`${floor.id}/${template.id}`);
  }, [floor.id, invalidate, onReady, template.id]);

  const routeClip = animations.find(({ name }) => name === `Route lights ${floor.name}`);

  return (
    <group position-y={-floor.elevation}>
      <primitive object={model} />
      {routeClip && <RouteLightMotion model={model} clip={routeClip} />}
    </group>
  );
}

function MirroredCamera({ frame, bounds }: { frame: MapFrame | null; bounds: PreviewFloor["bounds"] }) {
  const camerasRef = useRef<{
    ortho: OrthographicCamera & { manual: true };
    perspective: PerspectiveCamera & { manual: true };
  }>(null);
  const get = useThree((state) => state.get);
  const { width, height } = useThree((state) => state.size);

  useLayoutEffect(() => {
    if (!width || !height || (!frame && !bounds)) return;
    camerasRef.current ??= {
      ortho: Object.assign(new OrthographicCamera(), { manual: true as const }),
      perspective: Object.assign(new PerspectiveCamera(), { manual: true as const }),
    };
    const ortho = camerasRef.current.ortho;
    const camera = frame?.perspective ? camerasRef.current.perspective : ortho;
    if (frame) {
      new Matrix4().fromArray(frame.world).decompose(camera.position, camera.quaternion, camera.scale);
      camera.updateMatrixWorld(true);
      const viewportScale = new Matrix4().makeScale(frame.size[0] / width, frame.size[1] / height, 1);
      camera.projectionMatrix.fromArray(frame.projection).premultiply(viewportScale);
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    } else {
      const [minX, minZ, maxX, maxZ] = bounds;
      const x = (minX + maxX) / 2;
      const z = (minZ + maxZ) / 2;
      const longNorthSouth = maxZ - minZ > maxX - minX;
      ortho.up.set(0, 1, 0);
      ortho.position.set(x + (longNorthSouth ? 780 : 245), 590, z + (longNorthSouth ? 245 : 780));
      ortho.lookAt(x, 0, z);
      const rotation = ortho.quaternion.clone().invert();
      const corners = [[minX, minZ], [minX, maxZ], [maxX, minZ], [maxX, maxZ]]
        .map(([px, pz]) => new Vector3(px - x, 0, pz - z).applyQuaternion(rotation));
      const scale = Math.max(...corners.map((corner) => Math.max(Math.abs(corner.x) * 2 / width,
        Math.abs(corner.y) * 2 / height))) * 1.12;
      ortho.left = -width * scale / 2;
      ortho.right = width * scale / 2;
      ortho.bottom = -height * scale / 2;
      ortho.top = height * scale / 2;
      ortho.near = 1;
      ortho.far = 2400;
      ortho.zoom = 1;
      ortho.updateProjectionMatrix();
    }
    const store = get();
    if (store.camera !== camera) store.set({ camera });
    store.invalidate();
  }, [bounds, frame, get, height, width]);
  return null;
}

export function ModelViewport({
  sample, assets, floor, template, frame, anchorIndex, readyKey, onReady, dispatch,
}: {
  sample: PreviewSample;
  assets: string;
  floor: PreviewFloor;
  template: PreviewTemplate;
  frame: MapFrame | null;
  anchorIndex: number;
  readyKey: string;
  onReady: (key: string) => void;
  dispatch: (command: ViewCommand) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  useViewportGestures(viewportRef, dispatch, !!frame);
  const ready = readyKey === `${floor.id}/${template.id}`;
  const anchor = floor.anchors[anchorIndex];
  const orbitTarget = useMemo<Vector3Tuple>(() => {
    const [minX, minZ, maxX, maxZ] = floor.bounds;
    return [(minX + maxX) / 2, 0, (minZ + maxZ) / 2];
  }, [floor.bounds]);

  return (
    <div
      ref={viewportRef} className={viewportClass} data-viewport="model" data-floor={ready ? floor.name : undefined}
      data-state={ready ? "ready" : "loading"} data-template={ready ? template.id : undefined}
      aria-label={`R3F ${floor.name} 模型`}
    >
      <ModelErrorBoundary>
        <Canvas
          orthographic
          camera={{ near: 1, far: 2400, position: [0, 900, 0.001] }}
          frameloop="demand"
          dpr={[1, 1.75]}
          fallback={<p className={`${viewportStatusClass} z-10`} role="alert">当前浏览器无法启动 WebGL</p>}
        >
          <TemplateLighting template={template} floorId={floor.id} />
          <MirroredCamera frame={frame} bounds={floor.bounds} />
          {!frame && <OrbitControls target={orbitTarget} enableDamping={false} zoomToCursor minPolarAngle={0.02} maxPolarAngle={1.28}
            minZoom={0.45} maxZoom={12} />}
          {template.entranceBloom && <EntranceBloom />}
          <Suspense fallback={null}>
            <FloorModel modelUrl={`${assets}/${sample.model}`} floor={floor} template={template} onReady={onReady} />
            {anchor && (
              <Html position={[anchor.point[0] - sample.origin[0], anchor.height, sample.origin[1] - anchor.point[1]]}
                pointerEvents="none" zIndexRange={[5, 5]}>
                <span className={pinClass} data-anchor={anchor.label} aria-hidden="true" />
              </Html>
            )}
          </Suspense>
        </Canvas>
      </ModelErrorBoundary>
      {!ready && <p className={viewportStatusClass} role="status">正在加载整栋 GLB</p>}
    </div>
  );
}
