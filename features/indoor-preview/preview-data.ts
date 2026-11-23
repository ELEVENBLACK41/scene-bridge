export const assetRoot = "/preview/f1/assets";

export type Point = [number, number];

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
  credentials: { appName: string; key: string } | null;
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
