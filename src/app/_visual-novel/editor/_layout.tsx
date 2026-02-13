import { notFound } from "next/navigation";

export default function VisualNovelEditorDisabledLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  void children;
  notFound();
}
