"use client";

import { ArrowUp, Download, Minus, Plus, RotateCcw } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { buildingExportSpacing, type FengMapCredentials, type MapFrame, type PreviewExportMode, type PreviewRecord, type ViewCommand } from "./preview-data";
import { PreviewImport } from "./preview-import";
import { FengMapViewport } from "./viewports/fengmap-viewport";
import { ModelViewport } from "./viewports/model-viewport";
import type { MapControls } from "./viewports/use-fengmap-view";

const panelClass = "min-w-0 overflow-hidden rounded-xl border border-[#c6d5d0] bg-[#f8fbfa]";
const panelHeaderClass = "flex min-h-[58px] items-center justify-between gap-3 px-3.5 py-2.5";
const mutedClass = "text-[13px] text-[#516a64]";
const controlClass = "cursor-pointer border-[#c6d5d0] bg-[#f8fbfa] text-[#193833] hover:bg-[#e2ede8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#306c61] motion-reduce:transition-none";
const toggleClass = `${controlClass} aria-pressed:border-[#638677] aria-pressed:bg-[#cde1d8] aria-pressed:text-[#183e33]`;

type Authorization = { credentials: FengMapCredentials; revision: number };

function PreviewWorkspace({ record, authorization, importing }: {
  record: PreviewRecord;
  authorization: Authorization | null;
  importing: boolean;
}) {
  const { sample, assets } = record;
  const [selectedFloorId, setSelectedFloorId] = useState(sample.defaultFloorId);
  const [template, setTemplate] = useState(sample.templates[0]);
  const [camera, setCamera] = useState<{ frame: MapFrame; revision: number }>();
  const [anchorIndex, setAnchorIndex] = useState(0);
  const [readyKey, setReadyKey] = useState("");
  const [exporting, setExporting] = useState<PreviewExportMode | null>(null);
  const [downloadError, setDownloadError] = useState("");
  const controllerRef = useRef<MapControls | null>(null);
  const dispatch = useCallback((command: ViewCommand) => controllerRef.current?.dispatch(command), []);
  const onFrame = useCallback((next: MapFrame) => {
    if (authorization) setCamera({ frame: next, revision: authorization.revision });
  }, [authorization]);

  const frame = camera?.revision === authorization?.revision ? camera?.frame ?? null : null;
  const floor = sample.floors.find(({ id }) => id === (frame?.floorId ?? selectedFloorId))!;
  const switching = !!frame && selectedFloorId !== frame.floorId;
  const modelReady = readyKey === `${floor.id}/${template.id}`;
  const canControl = !!frame && !switching && modelReady;
  const canSelectFloor = canControl || (!authorization && modelReady);

  function selectFloor(id: number) {
    if (!authorization || controllerRef.current?.selectFloor(id)) {
      setSelectedFloorId(id);
      setAnchorIndex(0);
    }
  }

  async function exportModel(mode: PreviewExportMode) {
    setExporting(mode);
    setDownloadError("");
    try {
      const response = await fetch(`${assets}/${template.file}?download=${mode}`);
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(result?.error || "整栋 GLB 文件不可用，请重新导入。");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      const suffix = mode === "building" ? "spaced.glb" : "floors.zip";
      link.download = `${sample.mapId}-${template.id}-${suffix}`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : "导出失败。");
    } finally {
      setExporting(null);
    }
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="楼层" className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[13px] font-semibold">楼层</span>
          {sample.floors.map(({ id, name }) => (
            <Button key={id} type="button" variant="outline" size="sm" className={`min-w-10 ${toggleClass}`}
              aria-pressed={selectedFloorId === id} disabled={!canSelectFloor} onClick={() => selectFloor(id)}>
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

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div role="group" aria-label="整栋配色模板" className="flex flex-wrap items-center gap-1.5">
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
        <div className="flex flex-wrap items-center gap-2">
          {downloadError && <span role="alert" className="text-xs text-[#9e392d]">{downloadError}</span>}
          <Button type="button" variant="outline" size="sm" className={controlClass}
            disabled={!!exporting || importing} onClick={() => exportModel("floors")}>
            <Download aria-hidden="true" />{exporting === "floors" ? "正在打包…" : "分楼层导出 ZIP"}
          </Button>
          <Button type="button" size="sm" className="bg-[#234d41] text-white hover:bg-[#356659]"
            disabled={!!exporting || importing} onClick={() => exportModel("building")}>
            <Download aria-hidden="true" />{exporting === "building" ? "正在导出…" : "导出整栋 GLB"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 max-[800px]:grid-cols-1">
        <section className={panelClass} aria-labelledby="fengmap-title">
          <div className={panelHeaderClass}>
            <h2 className="font-semibold" id="fengmap-title">FengMap 原图</h2>
            <span className={mutedClass}>室内主题 · {floor.name}</span>
          </div>
          <FengMapViewport key={authorization?.revision ?? 0} sample={sample} assets={assets}
            credentials={authorization?.credentials ?? null} floor={floor} frame={frame} anchorIndex={anchorIndex}
            controllerRef={controllerRef} onFrame={onFrame} dispatch={dispatch} />
        </section>
        <section className={panelClass} aria-labelledby="model-title">
          <div className={panelHeaderClass}>
            <h2 className="font-semibold" id="model-title">R3F 模型</h2>
            <span className={mutedClass}>{template.label} · {floor.name}</span>
          </div>
          <ModelViewport sample={sample} assets={assets} floor={floor} template={template} frame={frame} anchorIndex={anchorIndex}
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
        <p className={mutedClass}>
          {frame ? "任意一栏拖动旋转，右键或 Shift 拖动平移，滚轮或双指缩放。" : "拖动右栏旋转模型。加载 FengMap 原图后可同步操作两个视口。"}
        </p>
      </div>
      <p className={`mt-2 ${mutedClass}`}>整栋导出使用 {buildingExportSpacing} 米示意层间距，分层文件以各自的楼面为零点。</p>
    </>
  );
}

export function IndoorPreview() {
  const [record, setRecord] = useState<PreviewRecord>();
  const [authorization, setAuthorization] = useState<Authorization | null>(null);
  const [importing, setImporting] = useState(false);

  return (
    <main className="flex-1 bg-[#e7efeb] font-sans text-[#193833]" lang="zh-CN">
      <div className="mx-auto max-w-[1640px] px-[clamp(16px,3vw,48px)] pt-8 pb-7">
        <header className="mb-5 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-[clamp(28px,4vw,42px)] leading-[1.12] font-bold tracking-[-0.045em]">室内地图双栏预览</h1>
            <p className={`mt-2 ${mutedClass}`}>导入地图和主题，按当前配色导出整栋模型</p>
          </div>
          <div className="flex items-center gap-1.5 text-[13px] font-semibold whitespace-nowrap max-[480px]:hidden">
            <ArrowUp size={16} aria-hidden="true" />北向俯视基准
          </div>
        </header>
        <PreviewImport importing={importing} onImporting={setImporting} onImported={setRecord}
          onAuthorize={(credentials) => setAuthorization((previous) => ({ credentials, revision: (previous?.revision ?? 0) + 1 }))} />
        {record ? <PreviewWorkspace key={record.assets} record={record} authorization={authorization} importing={importing} /> : (
          <div className="rounded-xl border border-[#c6d5d0] bg-[#f8fbfa] p-8 text-[#516a64]" role="status">
            {importing ? "转换完成后将在这里显示模型。" : "选择地图和主题文件开始预览。"}
          </div>
        )}
      </div>
    </main>
  );
}
