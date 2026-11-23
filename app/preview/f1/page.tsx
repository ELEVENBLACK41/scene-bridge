import type { Metadata } from "next";
import { F1Preview } from "./f1-preview";

export const metadata: Metadata = {
  title: "F1 双栏预览 | SceneBridge",
};

export default function F1PreviewPage() {
  return <F1Preview />;
}
