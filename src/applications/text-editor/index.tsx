import { OperatingSystemFile } from "@/hooks/use-operating-system";

export default function TextEditorApplication({
  file,
}: {
  file: OperatingSystemFile;
}) {
  return (
    <div className="w-full h-full bg-background">
      TEXT EDITOR FOR:
      <pre>{JSON.stringify(file, null, 2)}</pre>
    </div>
  );
}
