import type { Metadata } from "next";
import { IndoorPreview } from "@/features/indoor-preview/indoor-preview";

export const metadata: Metadata = {
  title: "室内地图双栏预览 | SceneBridge",
};

export default function PreviewPage() {
  return <IndoorPreview />;
}
