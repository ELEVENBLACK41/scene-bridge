"use client";

import { ArrowUp, Minus, Plus, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FengMapViewport } from "./fengmap-viewport";
import { ModelViewport, type CameraAction } from "./model-viewport";
import { assetRoot, type FloorSample, type MapFrame } from "./preview-data";

const panelClass = "min-w-0 overflow-hidden rounded-xl border border-[#c6d5d0] bg-[#f8fbfa]";
const panelHeaderClass = "flex min-h-[70px] items-center justify-between gap-3 px-3.5 py-2.5";
const mutedClass = "text-[13px] text-[#516a64]";
const controlClass =
  "cursor-pointer border-[#c6d5d0] bg-[#f8fbfa] text-[#193833] hover:bg-[#e2ede8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#306c61] motion-reduce:transition-none";

export function F1Preview() {
  const [sample, setSample] = useState<FloorSample>();
  const [loadError, setLoadError] = useState("");
  const [frame, setFrame] = useState<MapFrame | null>(null);
  const [activeAnchor, setActiveAnchor] = useState(0);
  const [modelReady, setModelReady] = useState(false);
  const [topView, setTopView] = useState(true);
  const commands = useRef<((action: CameraAction) => void) | null>(null);

  useEffect(() => {
    const request = new AbortController();
    fetch(`${assetRoot}/sample.json`, { signal: request.signal })
      .then((response) => {
        if (!response.ok) throw new Error("F1 预览资源未就绪，请按方案准备本机样本");
        return response.json() as Promise<FloorSample>;
      })
      .then(setSample)
      .catch((error: Error) => {
        if (error.name !== "AbortError") setLoadError(error.message);
      });
    return () => request.abort();
  }, []);

  const anchor = sample?.anchors[activeAnchor] ?? null;

  return (
    <main className="flex-1 bg-[#e7efeb] font-sans text-[#193833]" lang="zh-CN">
      <div className="mx-auto max-w-[1640px] px-[clamp(16px,3vw,48px)] pt-8 pb-7">
        <header className="mb-5 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-[clamp(28px,4vw,42px)] leading-[1.12] font-bold tracking-[-0.045em]">F1 双栏预览</h1>
            <p className={`mt-2 ${mutedClass}`}>室内地图 · 核对轮廓、孔洞与地标</p>
          </div>
          <div className="flex items-center gap-1.5 text-[13px] font-semibold whitespace-nowrap">
            <ArrowUp size={16} aria-hidden="true" />北向俯视基准
          </div>
        </header>

        {sample ? (
          <>
            <div className="grid grid-cols-2 gap-3 max-[800px]:grid-cols-1">
              <section className={panelClass} aria-labelledby="fengmap-title">
                <div className={panelHeaderClass}>
                  <div>
                    <h2 className="font-semibold" id="fengmap-title">FengMap 原图</h2>
                    <p className={`mt-1 ${mutedClass}`}>室内主题 · F1</p>
                  </div>
                  <span className="text-xs whitespace-nowrap text-[#516a64]">固定参照</span>
                </div>
                <FengMapViewport sample={sample} anchor={anchor} onFrame={setFrame} />
              </section>

              <section className={panelClass} aria-labelledby="model-title">
                <div className={panelHeaderClass}>
                  <div>
                    <h2 className="font-semibold" id="model-title">R3F 模型</h2>
                    <p className={`mt-1 ${mutedClass}`} data-camera-view={topView ? "top" : "orbit"}>{topView ? "北向俯视" : "自由视角"}</p>
                  </div>
                  <div className="flex items-center gap-1.5" role="group" aria-label="模型视角控制">
                    <Button className={controlClass} type="button" variant="outline" size="icon-sm" aria-label="放大" title="放大" disabled={!modelReady} onClick={() => commands.current?.("zoom-in")}>
                      <Plus aria-hidden="true" />
                    </Button>
                    <Button className={controlClass} type="button" variant="outline" size="icon-sm" aria-label="缩小" title="缩小" disabled={!modelReady} onClick={() => commands.current?.("zoom-out")}>
                      <Minus aria-hidden="true" />
                    </Button>
                    <Button className={controlClass} type="button" variant="outline" size="sm" disabled={!modelReady} onClick={() => commands.current?.("reset")}>
                      <RotateCcw aria-hidden="true" />重置视角
                    </Button>
                  </div>
                </div>
                <ModelViewport
                  sample={sample} frame={frame} anchor={anchor} commands={commands}
                  ready={modelReady} onReady={setModelReady} onTopView={setTopView}
                />
              </section>
            </div>

            <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="核对点">
                <span className="mr-1 text-[13px] font-semibold">核对点</span>
                {sample.anchors.map((item, index) => (
                  <Button
                    key={item.label}
                    className={`${controlClass} aria-pressed:border-[#c28671] aria-pressed:bg-[#f6dfd6] aria-pressed:text-[#79321f]`}
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-pressed={index === activeAnchor}
                    onClick={() => setActiveAnchor(index === activeAnchor ? -1 : index)}
                  >
                    {item.label}
                  </Button>
                ))}
              </div>
              <p className={mutedClass}>右栏拖动旋转，滚轮或双指缩放。模型高度以 F1 地面为基准，建筑实测标高待确认。</p>
            </div>
          </>
        ) : (
          <div className="rounded-xl border border-[#c6d5d0] bg-[#f8fbfa] p-8 text-[#516a64]" role={loadError ? "alert" : "status"}>
            {loadError || "正在读取本地 F1 样本"}
          </div>
        )}
      </div>
    </main>
  );
}
