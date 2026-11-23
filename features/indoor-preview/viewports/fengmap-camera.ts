import { Matrix4, Vector3 } from "three";
import type { MapFrame, Point, PreviewFloor } from "../preview-data";

type MapPoint = { x: number; y: number };
type CameraSnapshot = {
  isPerspectiveCamera?: boolean;
  matrixWorld: { elements: number[] };
  projectionMatrix: { elements: number[] };
  updateMatrixWorld(force: boolean): void;
};

export type FengMap = {
  on(event: "loaded" | "viewChanged" | "move" | "zoom", listener: () => void): void;
  on(event: "info", listener: (event: { InfoMode: number }) => void): void;
  getFloor(level: number): { bound: object };
  getLevel(): number;
  getVisibleLevels(): number[];
  setLevel(options: { level: number; animate: boolean; finish: () => void }): void;
  setFitView(bound: object, options: { animate: boolean; finish: () => void }): void;
  getViewMode(): number;
  setViewMode(options: { mode: number; animate: boolean; finish: () => void }): void;
  getRotation(): number;
  setRotation(options: { rotation: number; animate: boolean }): void;
  getTilt(): number;
  setTilt(options: { tilt: number; animate: boolean }): void;
  getZoom(): number;
  setZoom(options: { zoom: number; animate: boolean }): void;
  setCenter(options: MapPoint & { animate: boolean }): void;
  resize(width: number, height: number): void;
  dispose(): void;
  // The local 3.2.0 bundle exposes this snapshot method. Keep its use in this adapter.
  copyCamera(): CameraSnapshot;
};

export type FengMapSdk = {
  FMMap: new (options: {
    appName: string;
    key: string;
    container: HTMLElement;
    mapID: string;
    themeID: string;
    mapURL: string;
    themeURL: string;
    level: number;
    visibleLevels: number[];
    viewMode: number;
    rotation: number;
    zoomRange: [number, number];
  }) => FengMap;
  FMViewMode: { MODE_2D: number; MODE_3D: number };
  FMInfoMode: Record<string, number>;
  FMUtil: {
    coordsScreenToMap(map: FengMap, options: MapPoint & { level: number }): MapPoint & { z: number };
    coordsMapToScreen(map: FengMap, options: MapPoint & { level: number; height: number }): MapPoint | null;
  };
};

declare global {
  interface Window { fengmap?: FengMapSdk }
}

export function captureMapFrame(
  sdk: FengMapSdk, map: FengMap, floor: PreviewFloor, size: Point, origin: Point,
): MapFrame {
  const camera = map.copyCamera();
  camera.updateMatrixWorld(true);
  const world = [...camera.matrixWorld.elements];
  const projection = [...camera.projectionMatrix.elements];
  const center = sdk.FMUtil.coordsScreenToMap(map, { x: size[0] / 2, y: size[1] / 2, level: floor.id });
  const unproject = new Matrix4().fromArray(world).multiply(new Matrix4().fromArray(projection).invert());
  const near = new Vector3(0, 0, -1).applyMatrix4(unproject);
  const farther = new Vector3(0, 0, 0).applyMatrix4(unproject);
  const floorPoint = near.lerp(farther, (center.z - near.y) / (farther.y - near.y));

  // Rebase the SDK camera to the GLB's XY origin and the displayed floor's ground.
  world[12] += center.x - floorPoint.x - origin[0];
  world[13] -= center.z;
  world[14] += origin[1] - center.y - floorPoint.z;

  const points = floor.anchors.map(({ point: [x, y], height }): Point | null => {
    const pixel = sdk.FMUtil.coordsMapToScreen(map, { x, y, level: floor.id, height });
    return pixel && [pixel.x, pixel.y];
  });
  return { floorId: floor.id, size, perspective: !!camera.isPerspectiveCamera, world, projection, points };
}
