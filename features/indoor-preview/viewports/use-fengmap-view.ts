import { useEffect, type RefObject } from "react";
import type { FengMapCredentials, MapFrame, PreviewSample, ViewCommand } from "../preview-data";
import { captureMapFrame } from "./fengmap-camera";

export type MapControls = {
  dispatch(command: ViewCommand): void;
  selectFloor(id: number): boolean;
};

export function useFengMapView({
  sample, assets, credentials, initialFloorId, scriptReady, containerRef, controllerRef, onFrame, onError,
}: {
  sample: PreviewSample;
  assets: string;
  credentials: FengMapCredentials | null;
  initialFloorId: number;
  scriptReady: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  controllerRef: RefObject<MapControls | null>;
  onFrame: (frame: MapFrame) => void;
  onError: (message: string) => void;
}) {
  useEffect(() => {
    const element = containerRef.current;
    const sdk = window.fengmap;
    if (!element || !sdk || !scriptReady || !credentials) return;

    const modes = sdk.FMViewMode;
    const level = initialFloorId;
    const map = new sdk.FMMap({
      ...credentials,
      container: element,
      mapID: sample.mapId,
      themeID: sample.themeId,
      mapURL: `${assets}/map/`,
      themeURL: `${assets}/theme/`,
      level,
      visibleLevels: [level],
      viewMode: modes.MODE_2D,
      rotation: 0,
      zoomRange: [14, 23],
    });

    let active = true;
    let busy = true;
    let frame = 0;
    let width = element.clientWidth;
    let height = element.clientHeight;

    function publish() {
      if (!active || busy || frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (busy || !active) return;
        const floor = sample.floors.find(({ id }) => id === map.getLevel());
        if (floor && map.getVisibleLevels()[0] === floor.id) {
          onFrame(captureMapFrame(sdk!, map, floor, [width, height], sample.origin));
        }
      });
    }

    function finish() {
      busy = false;
      publish();
    }

    function reset() {
      busy = true;
      const fit = () => {
        if (!active) return;
        map.setRotation({ rotation: 0, animate: false });
        map.setFitView(map.getFloor(map.getLevel()).bound, { animate: false, finish });
      };
      if (map.getViewMode() === modes.MODE_2D) fit();
      else map.setViewMode({ mode: modes.MODE_2D, animate: false, finish: fit });
    }

    const resize = new ResizeObserver(() => {
      if (!active) return;
      const nextWidth = element.clientWidth;
      const nextHeight = element.clientHeight;
      if (!nextWidth || !nextHeight || (width === nextWidth && height === nextHeight)) return;
      width = nextWidth;
      height = nextHeight;
      map.resize(width, height);
      publish();
    });

    map.on("loaded", () => {
      if (!active) return;
      resize.observe(element);
      controllerRef.current = {
        selectFloor(id) {
          if (busy || id === map.getLevel()) return false;
          busy = true;
          map.setLevel({ level: id, animate: false, finish });
          return true;
        },
        dispatch(command) {
          if (busy) return;
          if (command.type === "reset") {
            reset();
            return;
          }
          if (command.type === "zoom") {
            map.setZoom({ zoom: map.getZoom() + command.delta, animate: false });
          } else if (command.type === "pan") {
            const center = sdk.FMUtil.coordsScreenToMap(map, {
              x: width / 2 - command.dx, y: height / 2 - command.dy, level: map.getLevel(),
            });
            map.setCenter({ x: center.x, y: center.y, animate: false });
          } else {
            const rotation = map.getRotation() - command.dx * 0.5;
            const tilt = Math.min(89, Math.max(30, map.getTilt() - command.dy * 0.5));
            const rotate = () => {
              if (!active) return;
              map.setRotation({ rotation, animate: false });
              map.setTilt({ tilt, animate: false });
              finish();
            };
            if (map.getViewMode() === modes.MODE_3D) rotate();
            else {
              busy = true;
              map.setViewMode({ mode: modes.MODE_3D, animate: false, finish: rotate });
            }
          }
          publish();
        },
      };
      reset();
    });

    map.on("viewChanged", publish);
    map.on("move", publish);
    map.on("zoom", publish);
    map.on("info", ({ InfoMode }) => {
      if (!active) return;
      const name = Object.keys(sdk.FMInfoMode).find((key) => sdk.FMInfoMode[key] === InfoMode);
      if (name?.endsWith("_ERROR")) onError(`原图加载失败（${name}）`);
    });
    return () => {
      active = false;
      controllerRef.current = null;
      resize.disconnect();
      cancelAnimationFrame(frame);
      map.dispose();
    };
  }, [assets, containerRef, controllerRef, credentials, initialFloorId, onError, onFrame, sample, scriptReady]);
}
