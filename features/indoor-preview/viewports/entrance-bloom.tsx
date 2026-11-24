import { useFrame, useThree } from "@react-three/fiber";
import { useLayoutEffect, useRef } from "react";
import { Vector2 } from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

export function EntranceBloom() {
  const get = useThree((state) => state.get);
  const { width, height } = useThree((state) => state.size);
  const dpr = useThree((state) => state.viewport.dpr);
  const passesRef = useRef<{ composer: EffectComposer; scenePass: RenderPass }>(null);

  useLayoutEffect(() => {
    const { gl, scene, camera, invalidate } = get();
    const composer = new EffectComposer(gl);
    const context = gl.getContext() as WebGL2RenderingContext;
    const samples = context.getInternalformatParameter(context.RENDERBUFFER, context.RGBA16F, context.SAMPLES) as Int32Array;
    if (samples.length) {
      composer.renderTarget1.samples = composer.renderTarget2.samples = Math.min(2, samples[0]);
    }
    const scenePass = new RenderPass(scene, camera);
    const bloom = new UnrealBloomPass(new Vector2(1, 1), 0.85, 0.43, 1.28);
    const output = new OutputPass();
    composer.addPass(scenePass);
    composer.addPass(bloom);
    composer.addPass(output);
    passesRef.current = { composer, scenePass };
    invalidate();
    return () => {
      passesRef.current = null;
      bloom.dispose();
      output.dispose();
      composer.dispose();
    };
  }, [get]);

  useLayoutEffect(() => {
    const composer = passesRef.current?.composer;
    if (!composer) return;
    composer.setPixelRatio(Math.min(dpr, 1.35));
    composer.setSize(width, height);
  }, [dpr, height, width]);

  useFrame(({ camera, gl, scene }, delta) => {
    const passes = passesRef.current;
    if (!passes) {
      gl.render(scene, camera);
      return;
    }
    passes.scenePass.camera = camera;
    passes.composer.render(delta);
  }, 1);

  return null;
}
