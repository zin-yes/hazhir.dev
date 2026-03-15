"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { memo } from "react";

/* ------------------------------------------------------------------ */
/*  Rename dialog                                                     */
/* ------------------------------------------------------------------ */

interface RenameDialogProps {
  isOpen: boolean;
  targetName: string;
  renameValue: string;
  errorMessage: string;
  onRenameValueChanged: (value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}

export const RenameDialog = memo(function RenameDialog({
  isOpen,
  targetName,
  renameValue,
  errorMessage,
  onRenameValueChanged,
  onSubmit,
  onClose,
}: RenameDialogProps) {
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename</DialogTitle>
          <DialogDescription>
            Choose a new name for {targetName || "this item"}.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="rename-input">Name</Label>
          <Input
            id="rename-input"
            value={renameValue}
            onChange={(event) => onRenameValueChanged(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onSubmit();
              }
            }}
            autoFocus
          />
          {errorMessage ? (
            <div className="text-xs text-destructive">{errorMessage}</div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSubmit}>Rename</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});

/* ------------------------------------------------------------------ */
/*  Create file / folder dialog                                       */
/* ------------------------------------------------------------------ */

interface CreateItemDialogProps {
  /** null when the dialog is closed; "file" or "folder" when open */
  createMode: "file" | "folder" | null;
  currentDirectoryPath: string;
  createValue: string;
  errorMessage: string;
  onCreateValueChanged: (value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}

export const CreateItemDialog = memo(function CreateItemDialog({
  createMode,
  currentDirectoryPath,
  createValue,
  errorMessage,
  onCreateValueChanged,
  onSubmit,
  onClose,
}: CreateItemDialogProps) {
  return (
    <Dialog
      open={Boolean(createMode)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {createMode === "folder" ? "New Folder" : "New File"}
          </DialogTitle>
          <DialogDescription>
            Create a {createMode === "folder" ? "folder" : "file"} in{" "}
            {currentDirectoryPath}.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="create-input">Name</Label>
          <Input
            id="create-input"
            value={createValue}
            onChange={(event) => onCreateValueChanged(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onSubmit();
              }
            }}
            autoFocus
          />
          {errorMessage ? (
            <div className="text-xs text-destructive">{errorMessage}</div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSubmit}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});
