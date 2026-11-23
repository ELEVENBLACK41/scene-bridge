import { getPreviewAsset } from "@/features/indoor-preview/server/preview-assets";

export async function GET(_request: Request, { params }: RouteContext<"/preview/f1/assets/[...path]">) {
  return getPreviewAsset((await params).path);
}
