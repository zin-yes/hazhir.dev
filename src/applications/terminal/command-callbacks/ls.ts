import type { Terminal } from "@xterm/xterm";

import type { CommandCallback } from "./index";
import { useSession } from "next-auth/react";
import UseOperatingSystem from "@/hooks/use-operating-system";
import { humanFileSize } from "@/applications/file-explorer";

async function ls(
  fullCommand: string,
  terminal: Terminal,
  session: ReturnType<typeof useSession>,
  windowIdentifier: string
): Promise<void> {
  const operatingSystem = UseOperatingSystem();
  const files = operatingSystem.getAllFiles();

  terminal.writeln(" ".repeat(terminal.cols));
  const width = Math.min(terminal.cols, 40);

  files.forEach((file) => {
    const fileSize = humanFileSize(new Blob([file.contents]).size);
    const characterCount = file.fileName.length + ("" + fileSize).length;

    terminal.writeln(
      file.fileName + " ".repeat(width - characterCount) + fileSize
    );
  });
  terminal.writeln(" ".repeat(terminal.cols));
}

export default ls satisfies CommandCallback;
