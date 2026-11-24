import { useEffect, type RefObject } from "react";
import type { ViewCommand } from "../preview-data";

export function useViewportGestures(
  viewportRef: RefObject<HTMLDivElement | null>,
  dispatch: (command: ViewCommand) => void,
  enabled = true,
) {
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !enabled) return;
    const pointers = new Map<number, PointerEvent>();

    function start(event: PointerEvent) {
      pointers.set(event.pointerId, event);
      viewport?.setPointerCapture(event.pointerId);
    }

    function move(event: PointerEvent) {
      const previous = pointers.get(event.pointerId);
      if (!previous) return;
      pointers.set(event.pointerId, event);
      if (pointers.size > 1) {
        const other = [...pointers.values()].find((pointer) => pointer.pointerId !== event.pointerId)!;
        const before = Math.hypot(previous.clientX - other.clientX, previous.clientY - other.clientY);
        const after = Math.hypot(event.clientX - other.clientX, event.clientY - other.clientY);
        if (before > 0 && after > 0) dispatch({ type: "zoom", delta: Math.log2(after / before) });
        return;
      }
      dispatch({
        type: event.shiftKey || (event.buttons & 6) !== 0 ? "pan" : "rotate",
        dx: event.clientX - previous.clientX,
        dy: event.clientY - previous.clientY,
      });
    }

    function end(event: PointerEvent) {
      pointers.delete(event.pointerId);
    }

    function wheel(event: WheelEvent) {
      event.preventDefault();
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport!.clientHeight : 1);
      dispatch({ type: "zoom", delta: Math.max(-1, Math.min(1, -pixels / 420)) });
    }

    function contextMenu(event: MouseEvent) {
      event.preventDefault();
    }

    viewport.addEventListener("pointerdown", start);
    viewport.addEventListener("pointermove", move);
    viewport.addEventListener("lostpointercapture", end);
    viewport.addEventListener("wheel", wheel, { passive: false });
    viewport.addEventListener("contextmenu", contextMenu);
    return () => {
      viewport.removeEventListener("pointerdown", start);
      viewport.removeEventListener("pointermove", move);
      viewport.removeEventListener("lostpointercapture", end);
      viewport.removeEventListener("wheel", wheel);
      viewport.removeEventListener("contextmenu", contextMenu);
    };
  }, [dispatch, enabled, viewportRef]);
}
