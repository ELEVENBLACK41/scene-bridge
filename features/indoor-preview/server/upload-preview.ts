import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { assetRoot } from "../preview-data";
import { importsRoot } from "./preview-assets";
import { runPreviewPython } from "./python-runner";

const maxUploadBytes = 128 * 1024 * 1024;

function errorResponse(error: string, status: number) {
  return Response.json({ error }, { status });
}

export async function uploadPreview(request: Request) {
  if (Number(request.headers.get("content-length")) > maxUploadBytes + 1024 * 1024) {
    return errorResponse("地图和主题文件合计最多 128 MB。", 413);
  }

  let map: FormDataEntryValue | null;
  let theme: FormDataEntryValue | null;
  try {
    const form = await request.formData();
    map = form.get("map");
    theme = form.get("theme");
  } catch {
    return errorResponse("无法读取上传内容，请重新选择地图和主题文件。", 400);
  }
  if (!(map instanceof File) || !(theme instanceof File) || !map.size || !theme.size) {
    return errorResponse("请选择地图文件和主题文件。", 400);
  }
  const mapExt = extname(map.name).toLowerCase();
  const themeExt = extname(theme.name).toLowerCase();
  if (![".fmap", ".zip"].includes(mapExt) || ![".theme", ".zip"].includes(themeExt)) {
    return errorResponse("地图支持 .fmap 或 ZIP，主题支持 .theme 或 ZIP。", 400);
  }
  if (map.size + theme.size > maxUploadBytes) return errorResponse("地图和主题文件合计最多 128 MB。", 413);

  const id = randomUUID();
  const output = join(importsRoot, id);
  const input = await mkdtemp(join(tmpdir(), "scenebridge-upload-"));
  const mapPath = join(input, "map" + mapExt);
  const themePath = join(input, "theme" + themeExt);
  try {
    await mkdir(importsRoot, { recursive: true });
    await Promise.all([
      writeFile(mapPath, new Uint8Array(await map.arrayBuffer())),
      writeFile(themePath, new Uint8Array(await theme.arrayBuffer())),
    ]);
    await runPreviewPython("prepare_preview.py", [
      output,
      "--map", mapPath, "--theme", themePath, "--theme-name", theme.name,
    ]);
    const sample = JSON.parse(await readFile(join(output, "sample.json"), "utf8"));
    return Response.json({ sample, assets: `${assetRoot}/imports/${id}` });
  } catch (error) {
    await rm(output, { recursive: true, force: true });
    const failure = error as { code?: number | string; stderr?: string; killed?: boolean };
    if (failure.code === 2 && failure.stderr) return errorResponse(failure.stderr.trim(), 422);
    if (failure.killed) return errorResponse("地图转换超过 5 分钟，未生成可导出的模型。", 504);
    if (failure.code === "ENOENT" || failure.stderr?.includes("ModuleNotFoundError")) {
      return errorResponse("本机 Python 转换环境未就绪，请按方案安装转换依赖。", 500);
    }
    return errorResponse("地图转换失败，请检查输入文件的格式和完整性。", 500);
  } finally {
    await rm(input, { recursive: true, force: true });
  }
}
