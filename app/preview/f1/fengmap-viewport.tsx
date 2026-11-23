"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { assetRoot, type Anchor, type FloorSample, type MapFrame, type Point } from "./preview-data";
import { pinClass, viewportClass, viewportStatusClass } from "./viewport-classes";

type MapPoint = { x: number; y: number };

type MapInstance = {
  on(event: "loaded", listener: () => void): void;
  on(event: "info", listener: (event: { InfoMode: number }) => void): void;
  getFloor(level: number): { bound: object };
  setFitView(bound: object, options: { animate: boolean; finish: () => void }): void;
  dispose(): void;
};

type FengMapSdk = {
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
  }) => MapInstance;
  FMViewMode: { MODE_2D: number };
  FMInfoMode: Record<string, number>;
  FMUtil: {
    coordsScreenToMap(map: MapInstance, options: MapPoint & { level: number }): MapPoint;
    coordsMapToScreen(map: MapInstance, options: MapPoint & { level: number }): MapPoint | null;
  };
};

declare global {
  interface Window {
    fengmap?: FengMapSdk;
  }
}

export function FengMapViewport({
  sample,
  anchor,
  onFrame,
}: {
  sample: FloorSample;
  anchor: Anchor | null;
  onFrame: (frame: MapFrame) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [points, setPoints] = useState<(Point | null)[]>();
  const [error, setError] = useState("");

  useEffect(() => {
    const element = container.current;
    if (!element || !scriptReady || !sample.credentials) return;

    const sdk = window.fengmap;
    if (!sdk) return;
    const level = sample.floorId;
    const map = new sdk.FMMap({
      ...sample.credentials,
      container: element,
      mapID: sample.mapId,
      themeID: sample.themeId,
      mapURL: `${assetRoot}/map/`,
      themeURL: `${assetRoot}/theme/`,
      level,
      visibleLevels: [level],
      viewMode: sdk.FMViewMode.MODE_2D,
      rotation: 0,
      zoomRange: [14, 23],
    });

    let frame = 0;
    let active = true;
    let fitting = false;
    let lastWidth = 0;
    let lastHeight = 0;

    function fit() {
      if (!element || !sdk || !active || fitting) return;
      const width = element.clientWidth;
      const height = element.clientHeight;
      if (!width || !height || (width === lastWidth && height === lastHeight)) return;
      lastWidth = width;
      lastHeight = height;
      fitting = true;

      map.setFitView(map.getFloor(level).bound, {
        animate: false,
        finish: () => {
          if (!active) return;
          // Unproject the fitted view to transfer its actual scale to the model.
          frame = requestAnimationFrame(() => {
            const center = sdk.FMUtil.coordsScreenToMap(map, { x: width / 2, y: height / 2, level });
            const east = sdk.FMUtil.coordsScreenToMap(map, { x: width / 2 + 100, y: height / 2, level });
            onFrame({ center: [center.x, center.y], pixelsPerUnit: 100 / (east.x - center.x) });
            setPoints(sample.anchors.map(({ point: [x, y] }) => {
              const pixel = sdk.FMUtil.coordsMapToScreen(map, { x, y, level });
              return pixel ? [pixel.x, pixel.y] : null;
            }));
            fitting = false;
            fit();
          });
        },
      });
    }

    const resize = new ResizeObserver(fit);
    map.on("loaded", () => {
      if (!active) return;
      resize.observe(element);
      fit();
    });
    map.on("info", ({ InfoMode }) => {
      if (!active) return;
      const name = Object.keys(sdk.FMInfoMode).find((name) => sdk.FMInfoMode[name] === InfoMode);
      if (name?.endsWith("_ERROR")) setError(`原图加载失败（${name}）`);
    });

    return () => {
      active = false;
      resize.disconnect();
      cancelAnimationFrame(frame);
      map.dispose();
    };
  }, [onFrame, sample, scriptReady]);

  const problem = !sample.credentials ? "请配置 FengMap Web 授权" : error;
  const point = anchor && points?.[sample.anchors.indexOf(anchor)];

  return (
    <div className={viewportClass} data-viewport="fengmap" data-state={problem ? "error" : points ? "ready" : "loading"}>
      {sample.credentials && (
        <Script
          src="/vendor/fengmap/3.2.0/fengmap.map.min.js"
          onReady={() => {
            if (window.fengmap) setScriptReady(true);
            else setError("无法初始化 FengMap SDK");
          }}
          onError={() => setError("无法读取本地 FengMap SDK")}
        />
      )}
      <div ref={container} className="pointer-events-none absolute inset-0" aria-label="FengMap F1 原图" />
      {point && anchor && (
        <span className={pinClass} style={{ left: point[0], top: point[1] }} data-anchor={anchor.label} aria-hidden="true" />
      )}
      {(problem || !points) && (
        <p className={viewportStatusClass} role="status">{problem || "正在加载原图与室内主题"}</p>
      )}
    </div>
  );
}
