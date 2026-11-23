"use client";

import { Html, OrbitControls, useGLTF } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { Component, Suspense, useEffect, useLayoutEffect, useRef, type ComponentRef, type ReactNode, type RefObject } from "react";
import { MathUtils, OrthographicCamera } from "three";
import { assetRoot, type Anchor, type FloorSample, type MapFrame } from "./preview-data";
import { pinClass, viewportClass, viewportStatusClass } from "./viewport-classes";

export type CameraAction = "zoom-in" | "zoom-out" | "reset";
export type CameraCommands = RefObject<((action: CameraAction) => void) | null>;

class ModelErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed
      ? <p className={`${viewportStatusClass} z-10`} role="alert">无法加载 F1 GLB，请检查本地预览资源</p>
      : this.props.children;
  }
}

function FloorModel({ onReady }: { onReady: (ready: boolean) => void }) {
  const { scene } = useGLTF(`${assetRoot}/F1.glb`, false, false);
  useEffect(() => {
    onReady(true);
    return () => onReady(false);
  }, [onReady]);
  return <primitive object={scene} />;
}

function ModelCamera({
  sample,
  frame,
  commandRef,
  onTopView,
}: {
  sample: FloorSample;
  frame: MapFrame | null;
  commandRef: CameraCommands;
  onTopView: (isTopView: boolean) => void;
}) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const get = useThree((state) => state.get);
  const { width, height } = useThree((state) => state.size);
  const invalidate = useThree((state) => state.invalidate);

  useLayoutEffect(() => {
    const orbit = controls.current;
    if (!orbit) return;

    const camera = get().camera as OrthographicCamera;
    const [minX, minY, maxX, maxY] = sample.bounds;
    const [x, y] = frame?.center ?? [(minX + maxX) / 2, (minY + maxY) / 2];
    const [originX, originY] = sample.origin;
    const centerX = x - originX;
    const centerZ = originY - y;
    const zoom = frame?.pixelsPerUnit ?? 0.87 * Math.min(width / (maxX - minX), height / (maxY - minY));

    orbit.target.set(centerX, 0, centerZ);
    // Approach the north-up overhead view without putting OrbitControls on its pole.
    camera.position.set(centerX, 900, centerZ + 0.001);
    camera.zoom = zoom;
    camera.updateProjectionMatrix();
    orbit.minZoom = zoom / 3;
    orbit.maxZoom = zoom * 25;
    orbit.update();
    orbit.saveState();
    invalidate();

    commandRef.current = (action) => {
      if (action === "reset") {
        orbit.reset();
      } else {
        const factor = action === "zoom-in" ? 1.35 : 1 / 1.35;
        camera.zoom = MathUtils.clamp(camera.zoom * factor, orbit.minZoom, orbit.maxZoom);
        camera.updateProjectionMatrix();
        orbit.update();
      }
      invalidate();
    };
    return () => { commandRef.current = null; };
  }, [get, commandRef, frame, height, invalidate, sample, width]);

  return (
    <OrbitControls
      ref={controls}
      enableDamping={false}
      maxPolarAngle={Math.PI / 2.04}
      onChange={() => {
        const orbit = controls.current;
        if (orbit) onTopView(orbit.getPolarAngle() < 0.002 && Math.abs(orbit.getAzimuthalAngle()) < 0.002);
      }}
    />
  );
}

export function ModelViewport({
  sample,
  frame,
  anchor,
  commands,
  ready,
  onReady,
  onTopView,
}: {
  sample: FloorSample;
  frame: MapFrame | null;
  anchor: Anchor | null;
  commands: CameraCommands;
  ready: boolean;
  onReady: (ready: boolean) => void;
  onTopView: (isTopView: boolean) => void;
}) {
  return (
    <div className={viewportClass} data-viewport="model" data-state={ready ? "ready" : "loading"} aria-label="R3F F1 模型">
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
          <ModelCamera sample={sample} frame={frame} commandRef={commands} onTopView={onTopView} />
          <Suspense fallback={null}>
            <FloorModel onReady={onReady} />
            {anchor && (
              <Html
                position={[anchor.point[0] - sample.origin[0], anchor.height + 0.04, sample.origin[1] - anchor.point[1]]}
                pointerEvents="none"
                zIndexRange={[5, 5]}
              >
                <span className={pinClass} data-anchor={anchor.label} aria-hidden="true" />
              </Html>
            )}
          </Suspense>
        </Canvas>
      </ModelErrorBoundary>
      {!ready && <p className={viewportStatusClass} role="status">正在加载 F1 GLB</p>}
    </div>
  );
}
