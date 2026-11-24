import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import { AnimationMixer, type AnimationClip, type Object3D } from "three";

export function RouteLightMotion({ model, clip }: { model: Object3D; clip: AnimationClip }) {
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const mixer = new AnimationMixer(model);
    const action = mixer.clipAction(clip).play();
    let timer: number | undefined;

    function syncPlayback() {
      window.clearInterval(timer);
      if (preference.matches || document.hidden) return;
      let previous = performance.now();
      timer = window.setInterval(() => {
        const now = performance.now();
        mixer.update((now - previous) / 1000);
        previous = now;
        invalidate();
      }, 1000 / 24);
    }

    syncPlayback();
    preference.addEventListener("change", syncPlayback);
    document.addEventListener("visibilitychange", syncPlayback);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", syncPlayback);
      preference.removeEventListener("change", syncPlayback);
      action.stop();
      mixer.uncacheRoot(model);
    };
  }, [clip, invalidate, model]);

  return null;
}
