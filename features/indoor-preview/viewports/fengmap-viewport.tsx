"use client";

import Script from "next/script";
import { useRef, useState, type RefObject } from "react";
import type { FengMapCredentials, MapFrame, PreviewFloor, PreviewSample, ViewCommand } from "../preview-data";
import { useFengMapView, type MapControls } from "./use-fengmap-view";
import { useViewportGestures } from "./use-viewport-gestures";
import { pinClass, viewportClass, viewportStatusClass } from "./viewport-classes";

export function FengMapViewport({
  sample, assets, credentials, floor, frame, anchorIndex, controllerRef, onFrame, dispatch,
}: {
  sample: PreviewSample;
  assets: string;
  credentials: FengMapCredentials | null;
  floor: PreviewFloor;
  frame: MapFrame | null;
  anchorIndex: number;
  controllerRef: RefObject<MapControls | null>;
  onFrame: (frame: MapFrame) => void;
  dispatch: (command: ViewCommand) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [error, setError] = useState("");
  const [initialFloorId] = useState(floor.id);
  useFengMapView({ sample, assets, credentials, initialFloorId, scriptReady, containerRef, controllerRef, onFrame, onError: setError });
  useViewportGestures(viewportRef, dispatch);

  const problem = credentials ? error : "填入 appName 和 key 后加载 FengMap";
  const point = frame?.points[anchorIndex];
  const anchor = floor.anchors[anchorIndex];

  return (
    <div
      ref={viewportRef} className={viewportClass} data-viewport="fengmap" data-floor={frame ? floor.name : undefined}
      data-state={!credentials ? "waiting" : problem ? "error" : frame ? "ready" : "loading"}
    >
      {credentials && (
        <Script
          src="/vendor/fengmap/3.2.0/fengmap.map.min.js"
          onReady={() => {
            if (window.fengmap) setScriptReady(true);
            else setError("无法初始化 FengMap SDK");
          }}
          onError={() => setError("无法读取本地 FengMap SDK")}
        />
      )}
      <div ref={containerRef} className="pointer-events-none absolute inset-0" aria-label={`FengMap ${floor.name} 原图`} />
      {point && anchor && (
        <span className={pinClass} style={{ left: point[0], top: point[1] }} data-anchor={anchor.label} aria-hidden="true" />
      )}
      {(problem || !frame) && (
        <p className={viewportStatusClass} role="status">{problem || "正在加载原图与室内主题"}</p>
      )}
    </div>
  );
}
