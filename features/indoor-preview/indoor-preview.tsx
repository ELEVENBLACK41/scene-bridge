"use client";

import { ArrowUp, Minus, Plus, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { assetRoot, type MapFrame, type PreviewSample, type ViewCommand } from "./preview-data";
import { FengMapViewport } from "./viewports/fengmap-viewport";
import { ModelViewport } from "./viewports/model-viewport";
import type { MapControls } from "./viewports/use-fengmap-view";

const panelClass = "min-w-0 overflow-hidden rounded-xl border border-[#c6d5d0] bg-[#f8fbfa]";
const panelHeaderClass = "flex min-h-[58px] items-center justify-between gap-3 px-3.5 py-2.5";
const mutedClass = "text-[13px] text-[#516a64]";
const controlClass = "cursor-pointer border-[#c6d5d0] bg-[#f8fbfa] text-[#193833] hover:bg-[#e2ede8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#306c61] motion-reduce:transition-none";
const toggleClass = `${controlClass} aria-pressed:border-[#638677] aria-pressed:bg-[#cde1d8] aria-pressed:text-[#183e33]`;

function PreviewWorkspace({ sample }: { sample: PreviewSample }) {
  const [selectedFloorId, setSelectedFloorId] = useState(sample.defaultFloorId);
  const [template, setTemplate] = useState(sample.templates[0]);
  const [frame, setFrame] = useState<MapFrame | null>(null);
  const [anchorIndex, setAnchorIndex] = useState(0);
  const [readyKey, setReadyKey] = useState("");
  const controllerRef = useRef<MapControls | null>(null);
  const dispatch = useCallback((command: ViewCommand) => controllerRef.current?.dispatch(command), []);

  const floor = sample.floors.find(({ id }) => id === (frame?.floorId ?? sample.defaultFloorId))!;
  const switching = !!frame && selectedFloorId !== frame.floorId;
  const canControl = !!frame && !switching && readyKey === `${frame.floorId}/${template.id}`;

  function selectFloor(id: number) {
    if (controllerRef.current?.selectFloor(id)) {
      setSelectedFloorId(id);
      setAnchorIndex(0);
    }
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="楼层" className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[13px] font-semibold">楼层</span>
          {sample.floors.map(({ id, name }) => (
            <Button key={id} type="button" variant="outline" size="sm" className={`min-w-10 ${toggleClass}`}
              aria-pressed={selectedFloorId === id} disabled={!canControl} onClick={() => selectFloor(id)}>
              {name}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-1.5" role="group" aria-label="双栏视角控制">
          <span className={`mr-1 hidden sm:inline ${mutedClass}`}>同步视角</span>
          <Button type="button" variant="outline" size="icon-sm" className={controlClass} aria-label="放大" title="放大"
            disabled={!canControl} onClick={() => dispatch({ type: "zoom", delta: 0.4 })}>
            <Plus aria-hidden="true" />
          </Button>
          <Button type="button" variant="outline" size="icon-sm" className={controlClass} aria-label="缩小" title="缩小"
            disabled={!canControl} onClick={() => dispatch({ type: "zoom", delta: -0.4 })}>
            <Minus aria-hidden="true" />
          </Button>
          <Button type="button" variant="outline" size="sm" className={controlClass} disabled={!canControl}
            onClick={() => dispatch({ type: "reset" })}>
            <RotateCcw aria-hidden="true" />重置视角
          </Button>
        </div>
      </div>

      <div role="group" aria-label="整栋配色模板" className="mb-3 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[13px] font-semibold">配色模板</span>
        {sample.templates.map((option) => (
          <Button key={option.id} type="button" variant="outline" size="sm"
            className={toggleClass} aria-pressed={template.id === option.id} onClick={() => setTemplate(option)}>
            <span className="flex -space-x-0.5" aria-hidden="true">
              {option.swatches.map((swatch, index) => (
                <span key={index} className="size-2.5 rounded-full border border-white shadow-[0_0_0_1px_#60797045]"
                  style={{ backgroundColor: swatch }} />
              ))}
            </span>
            {option.label}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 max-[800px]:grid-cols-1">
        <section className={panelClass} aria-labelledby="fengmap-title">
          <div className={panelHeaderClass}>
            <h2 className="font-semibold" id="fengmap-title">FengMap 原图</h2>
            <span className={mutedClass}>室内主题 · {floor.name}</span>
          </div>
          {/* FengMapViewport */}
          <FengMapViewport sample={sample} floor={floor} frame={frame} anchorIndex={anchorIndex}
            controllerRef={controllerRef} onFrame={setFrame} dispatch={dispatch} />
        </section>
        <section className={panelClass} aria-labelledby="model-title">
          <div className={panelHeaderClass}>
            <h2 className="font-semibold" id="model-title">R3F 模型</h2>
            <span className={mutedClass}>{template.label} · {floor.name}</span>
          </div>
          {/* R3F Model Viewport */}
          <ModelViewport sample={sample} floor={floor} template={template} frame={frame} anchorIndex={anchorIndex}
            readyKey={readyKey} onReady={setReadyKey} dispatch={dispatch} />
        </section>
      </div>

      <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="核对点" className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[13px] font-semibold">核对点</span>
          {floor.anchors.map(({ label, sourceId }, index) => (
            <Button key={sourceId + label} type="button" variant="outline" size="sm" className={toggleClass}
              aria-pressed={index === anchorIndex} onClick={() => setAnchorIndex(index === anchorIndex ? -1 : index)}>
              {label}
            </Button>
          ))}
        </div>
        <p className={mutedClass}>任意一栏拖动旋转，右键或 Shift 拖动平移，滚轮或双指缩放。</p>
      </div>
      <p className={`mt-2 ${mutedClass}`}>GLB 层间距为 {sample.floorSpacing} 米示意值。建筑实测标高待确认。</p>
    </>
  );
}

export function IndoorPreview() {
  const [sample, setSample] = useState<PreviewSample>();
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    const request = new AbortController();
    fetch(`${assetRoot}/sample.json`, { signal: request.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("预览资源未就绪，请按方案准备本机样本");
        const data: PreviewSample = await response.json();
        if (!data.floors?.length) throw new Error("请按方案重新生成整栋预览资源");
        if (!data.templates?.length) throw new Error("请按方案重新生成整栋配色资源");
        setSample(data);
      })
      .catch((error: Error) => {
        if (error.name !== "AbortError") setLoadError(error.message);
      });
    return () => request.abort();
  }, []);

  return (
    <main className="flex-1 bg-[#e7efeb] font-sans text-[#193833]" lang="zh-CN">
      <div className="mx-auto max-w-[1640px] px-[clamp(16px,3vw,48px)] pt-8 pb-7">
        <header className="mb-5 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-[clamp(28px,4vw,42px)] leading-[1.12] font-bold tracking-[-0.045em]">室内地图双栏预览</h1>
            <p className={`mt-2 ${mutedClass}`}>核对楼层轮廓、孔洞与地标</p>
          </div>
          <div className="flex items-center gap-1.5 text-[13px] font-semibold whitespace-nowrap max-[480px]:hidden">
            <ArrowUp size={16} aria-hidden="true" />北向俯视基准
          </div>
        </header>
        {sample ? <PreviewWorkspace sample={sample} /> : (
          <div className="rounded-xl border border-[#c6d5d0] bg-[#f8fbfa] p-8 text-[#516a64]" role={loadError ? "alert" : "status"}>
            {loadError || "正在读取本地室内地图样本"}
          </div>
        )}
      </div>
    </main>
  );
}
