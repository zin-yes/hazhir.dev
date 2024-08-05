"use client";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import UseOperatingSystem, {
  OperatingSystemFile,
} from "@/hooks/use-operating-system";
import { useEffect, useRef, useState } from "react";

export default function TextEditorApplication({
  file,
  identifier,
}: {
  file: OperatingSystemFile;
  identifier: string;
}) {
  const operatingSystem = UseOperatingSystem();

  const [contents, setContents] = useState<string>(
    file ? file.contents + "" : ""
  );
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const initialized = useRef<boolean>(false);
  const [fileName, setFileName] = useState<string>(file.fileName);

  useEffect(() => {
    if (!initialized.current && textAreaRef.current && operatingSystem) {
      initialized.current = true;
      window.addEventListener("storage", (event) => {
        if (file) {
          const _file = operatingSystem.getFile(file.directory, file.fileName);
          if (_file) setContents(_file.contents);
        } else {
          operatingSystem.setApplicationWindowTitle(
            identifier,
            "Text Editor - " + fileName + " ●"
          );
        }
      });

      if (file) {
        operatingSystem.setApplicationWindowTitle(
          identifier,
          "Text Editor - " + file.fileName
        );
      }
    }
  }, [textAreaRef, initialized]);

  useEffect(() => {
    if (file) {
      const _file = operatingSystem.getFile(file.directory, file.fileName);
      if (_file ? _file.contents !== contents : true) {
        operatingSystem.setApplicationWindowTitle(
          identifier,
          "Text Editor - " + file.fileName + " ●"
        );
      } else {
        operatingSystem.setApplicationWindowTitle(
          identifier,
          "Text Editor - " + file.fileName
        );
      }
    }
  }, [contents]);

  function saveFile() {
    if (file) {
      operatingSystem.saveFile(file.directory, file.fileName, contents);

      const _file = operatingSystem.getFile(file.directory, file.fileName);
      if (_file ? _file.contents !== contents : true) {
        operatingSystem.setApplicationWindowTitle(
          identifier,
          "Text Editor - " + file.fileName + "*"
        );
      } else {
        operatingSystem.setApplicationWindowTitle(
          identifier,
          "Text Editor - " + file.fileName
        );
      }
    }
  }

  return (
    <div className="w-full h-full bg-background flex flex-col">
      <textarea
        ref={textAreaRef}
        className="w-full h-full outline-none border-none active:border-none active:outline-none resize-none bg-background text-foreground text-lg p-4"
        rows={contents.split("\n").length}
        placeholder="Text file contents..."
        value={contents}
        wrap="hard"
        onChange={(event) => {
          setContents(event.target.value);
        }}
      />
      <div className="flex row gap-2 p-4">
        <Button
          onClick={() => {
            saveFile();
          }}
        >
          Save
        </Button>
      </div>
    </div>
  );
}
