import { getPreviewAsset } from "@/features/indoor-preview/server/preview-assets";

export async function GET(
  request: Request,
  { params }: RouteContext<"/preview/f1/assets/[...path]">,
) {
  const download = new URL(request.url).searchParams.get("download");
  const mode =
    download === "1" || download === "building"
      ? "building"
      : download === "floors"
        ? "floors"
        : null;
  return getPreviewAsset((await params).path, mode);
}
