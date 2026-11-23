"use client";

import { Html, useGLTF } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { Component, Suspense, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { Color, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, OrthographicCamera, PerspectiveCamera } from "three";
import { assetRoot, type MapFrame, type PreviewFloor, type PreviewSample, type PreviewTemplate, type ViewCommand } from "../preview-data";
import { EntranceBloom } from "./entrance-bloom";
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

function FloorModel({ sample, floor, template, onReady }: {
  sample: PreviewSample;
  floor: PreviewFloor;
  template: PreviewTemplate;
  onReady: (key: string) => void;
}) {
  const { scene } = useGLTF(`${assetRoot}/${sample.model}`, false, false);
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

  const model = useMemo(() => {
    const selected = scene.getObjectByName(floor.name)?.clone();
    selected?.traverse((node) => {
      if (node instanceof Mesh) {
        const key = node.userData.kind === "extent" ? "extent" : String(node.userData.sourceTypeId);
        const index = template.fidIndexes?.[node.userData.sourceFid] ?? template.indexes[key] ?? template.indexes.other;
        node.material = materials[index];
      }
    });
    return selected;
  }, [floor.name, materials, scene, template.fidIndexes, template.indexes]);
  if (!model) throw new Error(`GLB 缺少 ${floor.name} 分组`);

  useLayoutEffect(() => {
    invalidate();
    onReady(`${floor.id}/${template.id}`);
  }, [floor.id, invalidate, onReady, template.id]);

  return <group position-y={-floor.elevation}><primitive object={model} /></group>;
}

function MirroredCamera({ frame }: { frame: MapFrame | null }) {
  const camerasRef = useRef<{
    ortho: OrthographicCamera & { manual: true };
    perspective: PerspectiveCamera & { manual: true };
  }>(null);
  const get = useThree((state) => state.get);
  const { width, height } = useThree((state) => state.size);

  useLayoutEffect(() => {
    if (!frame || !width || !height) return;
    camerasRef.current ??= {
      ortho: Object.assign(new OrthographicCamera(), { manual: true as const }),
      perspective: Object.assign(new PerspectiveCamera(), { manual: true as const }),
    };
    const camera = frame.perspective ? camerasRef.current.perspective : camerasRef.current.ortho;
    new Matrix4().fromArray(frame.world).decompose(camera.position, camera.quaternion, camera.scale);
    camera.updateMatrixWorld(true);
    const viewportScale = new Matrix4().makeScale(frame.size[0] / width, frame.size[1] / height, 1);
    camera.projectionMatrix.fromArray(frame.projection).premultiply(viewportScale);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    const store = get();
    if (store.camera !== camera) store.set({ camera });
    store.invalidate();
  }, [frame, get, height, width]);
  return null;
}

export function ModelViewport({
  sample, floor, template, frame, anchorIndex, readyKey, onReady, dispatch,
}: {
  sample: PreviewSample;
  floor: PreviewFloor;
  template: PreviewTemplate;
  frame: MapFrame | null;
  anchorIndex: number;
  readyKey: string;
  onReady: (key: string) => void;
  dispatch: (command: ViewCommand) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  useViewportGestures(viewportRef, dispatch);
  const ready = readyKey === `${floor.id}/${template.id}`;
  const anchor = floor.anchors[anchorIndex];

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
          <MirroredCamera frame={frame} />
          {template.entranceBloom && <EntranceBloom />}
          <Suspense fallback={null}>
            <FloorModel sample={sample} floor={floor} template={template} onReady={onReady} />
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
