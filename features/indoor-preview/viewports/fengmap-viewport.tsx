"use client";

import Script from "next/script";
import { useRef, useState, type RefObject } from "react";
import type { MapFrame, PreviewFloor, PreviewSample, ViewCommand } from "../preview-data";
import { useFengMapView, type MapControls } from "./use-fengmap-view";
import { useViewportGestures } from "./use-viewport-gestures";
import { pinClass, viewportClass, viewportStatusClass } from "./viewport-classes";

export function FengMapViewport({
  sample, floor, frame, anchorIndex, controllerRef, onFrame, dispatch,
}: {
  sample: PreviewSample;
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
  useFengMapView({ sample, scriptReady, containerRef, controllerRef, onFrame, onError: setError });
  useViewportGestures(viewportRef, dispatch);

  const problem = sample.credentials ? error : "请配置 FengMap Web 授权";
  const point = frame?.points[anchorIndex];
  const anchor = floor.anchors[anchorIndex];

  return (
    <div
      ref={viewportRef} className={viewportClass} data-viewport="fengmap" data-floor={frame ? floor.name : undefined}
      data-state={problem ? "error" : frame ? "ready" : "loading"}
    >
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
