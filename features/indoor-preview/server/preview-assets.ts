import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { buildingExportSpacing, type PreviewExportMode, type PreviewSample } from "../preview-data";
import { runPreviewPython } from "./python-runner";

export const importsRoot = resolve(".scene-bridge", "imports");

const contentTypes: Record<string, string> = {
  ".fmap": "application/octet-stream",
  ".theme": "application/json",
  ".json": "application/json",
  ".glb": "model/gltf-binary",
  ".fmi": "image/png",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gltf": "model/gltf+json",
  ".bin": "application/octet-stream",
};

async function exportPreviewAsset(root: string, path: string[], mode: PreviewExportMode) {
  const manifest = resolve(root, "sample.json");
  const sample: PreviewSample = JSON.parse(await readFile(manifest, "utf8"));
  const template = sample.templates.find(({ file }) => path.length === 1 && path[0] === file);
  if (!template) return Response.json({ error: "请先选择可导出的配色模板。" }, { status: 404 });

  const suffix = mode === "building" ? "spaced.glb" : "floors.zip";
  const filename = `${sample.mapId}-${template.id}-${suffix}`;
  const scratch = await mkdtemp(join(tmpdir(), "scenebridge-export-"));
  const output = join(scratch, suffix);
  try {
    await runPreviewPython("export_models.py", [
      resolve(root, template.file), manifest, output,
      "--mode", mode, "--spacing", String(buildingExportSpacing),
    ]);
    const bytes = await readFile(output);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": mode === "building" ? contentTypes[".glb"] : "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const failure = error as { code?: number | string; stderr?: string };
    if (failure.code === 2 && failure.stderr) return Response.json({ error: failure.stderr.trim() }, { status: 422 });
    return Response.json({ error: "整栋 GLB 文件不可用，请重新导入。" }, { status: 500 });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

export async function getPreviewAsset(path: string[], download: PreviewExportMode | null) {
  let directory = process.env.SCENE_BRIDGE_F1_ASSETS;
  if (path[0] === "imports") {
    const id = path[1];
    if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
      return new Response(null, { status: 404 });
    }
    directory = resolve(importsRoot, id);
    path = path.slice(2);
  }
  if (!directory) return new Response(null, { status: 404 });

  const root = resolve(/* turbopackIgnore: true */ directory);
  const file = resolve(root, ...path);
  const contentType = contentTypes[extname(file)];
  if (!file.startsWith(root + sep) || !contentType) {
    return new Response(null, { status: 404 });
  }

  try {
    if (download) return await exportPreviewAsset(root, path, download);
    const bytes = await readFile(file);
    const headers: Record<string, string> = { "Content-Type": contentType };
    if (file === resolve(root, "sample.json")) headers["Cache-Control"] = "no-store";
    return new Response(new Uint8Array(bytes), { headers });
  } catch (error) {
    if (error instanceof Error && "code" in error && ["ENOENT", "ENOTDIR"].includes(String(error.code))) {
      return new Response(null, { status: 404 });
    }
    throw error;
  }
}
