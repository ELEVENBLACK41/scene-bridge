export const assetRoot = "/preview/f1/assets";

export type Point = [number, number];
export type Vector3Tuple = [number, number, number];

export type Anchor = {
  label: string;
  point: Point;
  height: number;
  kind: "extent" | "model";
  sourceId: number;
};

export type PreviewFloor = {
  id: number;
  name: string;
  elevation: number;
  anchors: Anchor[];
};

export type PreviewSample = {
  mapId: string;
  themeId: string;
  defaultFloorId: number;
  floorSpacing: number;
  origin: Point;
  model: string;
  floors: PreviewFloor[];
  templates: PreviewTemplate[];
  credentials: { appName: string; key: string } | null;
};

export type PreviewTemplate = {
  id: string;
  label: string;
  file: string;
  background: string;
  fill: number;
  swatches: string[];
  indexes: Record<string, number>;
  fidIndexes?: Record<string, number>;
  materials: {
    name: string;
    color: Vector3Tuple;
    roughness: number;
    emission?: Vector3Tuple;
    emissionStrength?: number;
    unlit?: boolean;
  }[];
  lights?: {
    color: Vector3Tuple;
    intensity: number;
    range: number;
    positions: Record<number, Vector3Tuple[]>;
  };
  entranceBloom?: boolean;
};

export type MapFrame = {
  floorId: number;
  size: Point;
  perspective: boolean;
  world: number[];
  projection: number[];
  points: (Point | null)[];
};

export type ViewCommand =
  | { type: "zoom"; delta: number }
  | { type: "rotate" | "pan"; dx: number; dy: number }
  | { type: "reset" };
