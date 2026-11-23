"use client";

import { Html, useGLTF } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { Component, Suspense, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { Matrix4, OrthographicCamera, PerspectiveCamera } from "three";
import { assetRoot, type MapFrame, type PreviewFloor, type PreviewSample, type ViewCommand } from "../preview-data";
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

function FloorModel({ sample, floor, onReady }: {
  sample: PreviewSample;
  floor: PreviewFloor;
  onReady: (floorId: number) => void;
}) {
  const { scene } = useGLTF(`${assetRoot}/${sample.model}`, false, false);
  const invalidate = useThree((state) => state.invalidate);
  const model = useMemo(() => scene.getObjectByName(floor.name)?.clone(), [floor.name, scene]);
  if (!model) throw new Error(`GLB 缺少 ${floor.name} 分组`);

  useLayoutEffect(() => {
    invalidate();
    onReady(floor.id);
  }, [floor.id, invalidate, onReady]);

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
  sample, floor, frame, anchorIndex, readyFloorId, onReady, dispatch,
}: {
  sample: PreviewSample;
  floor: PreviewFloor;
  frame: MapFrame | null;
  anchorIndex: number;
  readyFloorId: number | null;
  onReady: (floorId: number) => void;
  dispatch: (command: ViewCommand) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  useViewportGestures(viewportRef, dispatch);
  const ready = readyFloorId === floor.id;
  const anchor = floor.anchors[anchorIndex];

  return (
    <div
      ref={viewportRef} className={viewportClass} data-viewport="model" data-floor={ready ? floor.name : undefined}
      data-state={ready ? "ready" : "loading"} aria-label={`R3F ${floor.name} 模型`}
    >
      <ModelErrorBoundary>
        <Canvas
          orthographic
          camera={{ near: 1, far: 2400, position: [0, 900, 0.001] }}
          frameloop="demand"
          dpr={[1, 1.75]}
          fallback={<p className={`${viewportStatusClass} z-10`} role="alert">当前浏览器无法启动 WebGL</p>}
        >
          <color attach="background" args={["#e4ebe9"]} />
          <hemisphereLight args={["#ffffff", "#718492", 2.4]} />
          <directionalLight position={[-250, 500, -160]} intensity={0.75} />
          <MirroredCamera frame={frame} />
          <Suspense fallback={null}>
            <FloorModel sample={sample} floor={floor} onReady={onReady} />
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
