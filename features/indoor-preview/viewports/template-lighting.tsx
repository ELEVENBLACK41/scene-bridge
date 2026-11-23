import { memo } from "react";
import { Color } from "three";
import type { PreviewTemplate } from "../preview-data";

export const TemplateLighting = memo(function TemplateLighting({
  template,
  floorId,
}: {
  template: PreviewTemplate;
  floorId: number;
}) {
  const lights = template.lights;
  const color = lights && new Color().fromArray(lights.color);

  return (
    <>
      <color attach="background" args={[template.background]} />
      <hemisphereLight args={["#ffffff", "#a39485", template.fill]} />
      <directionalLight position={[-250, 500, -160]} intensity={template.fill * 0.35} />
      {lights?.positions[floorId]?.map((position, index) => (
        <pointLight key={index} position={position} color={color} intensity={lights.intensity} distance={lights.range} decay={2} />
      ))}
    </>
  );
});
