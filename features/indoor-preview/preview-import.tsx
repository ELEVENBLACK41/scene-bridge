"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FengMapCredentials, PreviewRecord } from "./preview-data";

const fieldClass = "border-[#c6d5d0] bg-white text-[#193833] file:text-[#193833] placeholder:text-[#62746d]";
const formButton = "justify-self-start border-[#9bb7aa] bg-[#e1eee8] text-[#193833] hover:bg-[#d3e6dc]";

export function PreviewImport({ importing, onImporting, onImported, onAuthorize }: {
  importing: boolean;
  onImporting: (busy: boolean) => void;
  onImported: (record: PreviewRecord) => void;
  onAuthorize: (credentials: FengMapCredentials) => void;
}) {
  const [feedback, setFeedback] = useState<{ text: string; error: boolean }>();
  const [credentialError, setCredentialError] = useState("");

  async function importFiles(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const files = new FormData(event.currentTarget);
    onImporting(true);
    setFeedback(undefined);
    try {
      const response = await fetch("/preview/f1/import", { method: "POST", body: files });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result) throw new Error(result?.error || "无法导入地图和主题。");
      const record: PreviewRecord = result;
      onImported(record);
      setFeedback({ text: `已转换 ${record.sample.floors.length} 个楼层。`, error: false });
    } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : "导入失败。", error: true });
    } finally {
      onImporting(false);
    }
  }

  function authorize(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const appName = String(values.get("appName") ?? "").trim();
    const key = String(values.get("key") ?? "").trim();
    if (!appName || !key) {
      setCredentialError("请填写 appName 和 key。");
      return;
    }
    setCredentialError("");
    onAuthorize({ appName, key });
  }

  return (
    <section aria-label="地图导入与授权" className="mb-4 grid gap-4 rounded-xl border border-[#c6d5d0] bg-[#f8fbfa] p-4 xl:grid-cols-2">
      <form onSubmit={importFiles} className="grid min-w-0 gap-2.5">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid min-w-0 gap-1 text-sm font-medium">
            地图文件
            <Input className={fieldClass} name="map" type="file" accept=".fmap,.zip" required disabled={importing} />
          </label>
          <label className="grid min-w-0 gap-1 text-sm font-medium">
            主题文件
            <Input className={fieldClass} name="theme" type="file" accept=".theme,.zip" required disabled={importing} />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="outline" size="sm" className={formButton} disabled={importing}>
            {importing ? "正在转换…" : "导入并转换"}
          </Button>
          {importing && <span role="status" className="text-xs text-[#516a64]">正在本机生成整栋 GLB</span>}
          {feedback && (
            <span role={feedback.error ? "alert" : "status"} className={feedback.error ? "text-xs text-[#9e392d]" : "text-xs text-[#516a64]"}>
              {feedback.text}
            </span>
          )}
        </div>
      </form>
      <form onSubmit={authorize} className="grid min-w-0 gap-2.5 border-t border-[#c6d5d0] pt-3 xl:border-t-0 xl:border-l xl:pt-0 xl:pl-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid min-w-0 gap-1 text-sm font-medium">
            appName
            <Input className={fieldClass} name="appName" autoComplete="off" required />
          </label>
          <label className="grid min-w-0 gap-1 text-sm font-medium">
            key
            <Input className={fieldClass} name="key" type="password" autoComplete="new-password" required />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="outline" size="sm" className={formButton}>加载 FengMap</Button>
          {credentialError && <span role="alert" className="text-xs text-[#9e392d]">{credentialError}</span>}
        </div>
      </form>
    </section>
  );
}
