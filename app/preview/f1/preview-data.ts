export const assetRoot = "/preview/f1/assets";

export type Point = [number, number];

export type Anchor = {
  label: string;
  point: Point;
  height: number;
  kind: "extent" | "model";
  sourceId: number;
};

export type FloorSample = {
  mapId: string;
  themeId: string;
  floorId: number;
  origin: Point;
  bounds: [number, number, number, number];
  anchors: Anchor[];
  credentials: { appName: string; key: string } | null;
};

export type MapFrame = {
  center: Point;
  pixelsPerUnit: number;
};
