import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const contentTypes: Record<string, string> = {
  ".fmap": "application/octet-stream",
  ".theme": "application/json",
  ".json": "application/json",
  ".glb": "model/gltf-binary",
  ".fmi": "image/png",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const directory = process.env.SCENE_BRIDGE_F1_ASSETS;
  if (!directory) return new Response(null, { status: 404 });

  const { path } = await params;
  const root = resolve(directory);
  const file = resolve(root, ...path);
  const contentType = contentTypes[extname(file)];
  if (!file.startsWith(root + sep) || !contentType) {
    return new Response(null, { status: 404 });
  }

  try {
    const bytes = await readFile(file);
    if (file === resolve(root, "sample.json")) {
      const { FENGMAP_APP_NAME: appName, FENGMAP_KEY: key } = process.env;
      return Response.json(
        { ...JSON.parse(bytes.toString("utf8")), credentials: appName && key ? { appName, key } : null },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": contentType } });
  } catch (error) {
    if (error instanceof Error && "code" in error && ["ENOENT", "ENOTDIR"].includes(String(error.code))) {
      return new Response(null, { status: 404 });
    }
    throw error;
  }
}
