import { Button } from "@/components/ui/button";
import { Save } from "lucide-react";

type EditorToolbarProps = {
  fileName: string;
  hasUnsavedChanges: boolean;
  onSave: () => void;
};

/**
 * Toolbar at the top of the text editor showing the current file name,
 * an unsaved-changes indicator, and a Save button.
 */
export default function EditorToolbar({
  fileName,
  hasUnsavedChanges,
  onSave,
}: EditorToolbarProps) {
  return (
    <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-2">
      <div className="text-sm font-medium text-foreground">
        {fileName}
        {hasUnsavedChanges && (
          <span className="ml-2 text-xs text-orange-500">(unsaved)</span>
        )}
      </div>
      <Button onClick={onSave} disabled={!hasUnsavedChanges} size="sm">
        <Save className="mr-2 h-4 w-4" />
        Save
      </Button>
    </div>
  );
}
