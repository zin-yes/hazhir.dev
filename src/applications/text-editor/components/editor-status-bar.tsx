type EditorStatusBarProps = {
  totalLineCount: number;
  totalCharacterCount: number;
};

/**
 * Status bar at the bottom of the text editor showing line and character counts.
 */
export default function EditorStatusBar({
  totalLineCount,
  totalCharacterCount,
}: EditorStatusBarProps) {
  return (
    <div className="flex items-center justify-between border-t bg-muted/30 px-3 py-1 text-xs text-muted-foreground">
      <span>Lines: {totalLineCount}</span>
      <span>Characters: {totalCharacterCount}</span>
    </div>
  );
}
