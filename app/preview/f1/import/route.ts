import { uploadPreview } from "@/features/indoor-preview/server/upload-preview";

export async function POST(request: Request) {
  return uploadPreview(request);
}
