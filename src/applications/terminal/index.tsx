"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { ITheme, Terminal } from "@xterm/xterm";
import lodash from "lodash";
import { useTheme } from "next-themes";

import { FitAddon } from "@xterm/addon-fit";

import themes from "./themes.json";

import { useSession } from "@/auth/client";
import {
  FILE_PATH_DROP_EVENT,
  hasFileDragType,
  readDroppedPathsFromDataTransfer,
} from "@/lib/file-transfer-dnd";
import { setActiveTerminalWindow } from "./command-callbacks/cd";
import {
  getCommandLinePrefix,
  insertTextIntoCommandBuffer,
  parseCommand,
} from "./command-line-routine";
import { setCwd } from "./command-callbacks/cd";

import ansi from "ansi-escape-sequences";
import figlet from "figlet";

export default function TerminalApplication({
  windowIdentifier,
  initialPath,
}: {
  windowIdentifier: string;
  initialPath?: string;
}) {
  const [resizeMessage, setResizeMessage] = useState<string>("");

  // TODO: Rewrite debounce resize message.
  let debouncedReszieMessage = "";
  const setResizeMessageDebounced = lodash.debounce(
    (value: string) => setResizeMessage(value),
    600,
  );

  const { systemTheme: theme } = useTheme();

  // const terminalTheme: ITheme = theme === "dark" ? themes.dark : themes.light;
  const terminalTheme: ITheme = themes.dark;

  const terminal = useMemo<Terminal>(() => {
    return new Terminal({
      fontSize: 18,
      theme: terminalTheme,
      convertEol: true,
    });
  }, []);

  const fitAddon = useMemo<FitAddon>(() => {
    return new FitAddon();
  }, []);

  const initialized = useRef<boolean>(false);
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const terminalResizeObserver = useMemo<ResizeObserver>(
    () =>
      new ResizeObserver(() => {
        fitAddon.fit();

        setResizeMessage(`${terminal.cols} x ${terminal.rows}`);
        setResizeMessageDebounced("");
      }),
    [terminal, fitAddon],
  );
  useEffect(() => {
    if (resizeMessage !== "") {
      setTimeout(() => {
        setResizeMessage("");
        setResizeMessageDebounced("");
      }, 600);
    }
  }, [debouncedReszieMessage]);

  useEffect(() => {
    if (terminal) {
      terminal.options.theme = terminalTheme;
    }
  }, [terminalTheme]);

  const session = useSession();
  const sessionRef = useRef(session);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const quoteShellPath = (path: string) => {
    if (!/[\s"'`$\\]/.test(path)) return path;
    return `"${path.replace(/(["`$\\])/g, "\\$1")}"`;
  };

  const insertDroppedPaths = (paths: string[]) => {
    if (!terminal) return;
    const unique = Array.from(new Set(paths.filter(Boolean)));
    if (unique.length === 0) return;
    const text = unique.map((path) => quoteShellPath(path)).join(" ");
    insertTextIntoCommandBuffer(terminal, text);
  };

  useEffect(() => {
    if (
      terminalContainerRef.current &&
      terminalRef.current &&
      session.status !== "loading"
    ) {
      if (!initialized.current) {
        initialized.current = true;
        terminalResizeObserver.observe(terminalContainerRef.current);

        terminal.loadAddon(fitAddon);
        terminal.open(terminalRef.current);

        terminalContainerRef.current.addEventListener("mousedown", (event) => {
          event.preventDefault();
          terminal.focus();
        });

        fitAddon.fit();

        const currentSession = sessionRef.current;
        const currentUser =
          currentSession.status === "authenticated"
            ? (currentSession.data?.user as
                | { username?: string; name?: string; id?: string }
                | undefined)
            : undefined;
        const username =
          currentSession.status === "authenticated"
            ? (currentUser?.username ??
              currentUser?.name ??
              currentUser?.id ??
              "")
            : "";

        figlet(
          "hazhir.dev",
          { font: "Doom", width: terminal.cols, horizontalLayout: "default" },
          (error, result: string | undefined) => {
            if (!error) {
              result?.split("\n").forEach((line) => {
                terminal.writeln(line);
              });
              terminal.writeln(
                ansi.style.reset +
                  `${`Welcome ${username.trim()}. `}For a list of commands type ` +
                  ansi.style.black +
                  "`" +
                  ansi.style.gray +
                  "help" +
                  ansi.style.black +
                  "`" +
                  ansi.style.reset +
                  "." +
                  ansi.style.reset,
              );
              terminal.writeln(" ".repeat(terminal.cols));
            }

            setActiveTerminalWindow(windowIdentifier);
            if (initialPath) {
              setCwd(initialPath, windowIdentifier);
            }
            terminal.write(getCommandLinePrefix(username));

            terminal.onKey(async (event) => {
              await parseCommand(
                terminal,
                event,
                sessionRef.current,
                windowIdentifier,
              );
            });
          },
        );

        terminal.onData(() => {});
      }
    }
  }, [
    terminalContainerRef,
    terminalRef,
    terminal,
    fitAddon,
    terminalResizeObserver,
    session,
    initialPath,
  ]);

  useEffect(() => {
    const root = terminalContainerRef.current;
    if (!root) return;

    const handleCustomPathDrop = (event: Event) => {
      const customEvent = event as CustomEvent<{ paths?: string[] }>;
      const paths = customEvent.detail?.paths;
      if (!paths || paths.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      insertDroppedPaths(paths);
      terminal.focus();
    };

    root.addEventListener(
      FILE_PATH_DROP_EVENT,
      handleCustomPathDrop as EventListener,
    );

    const handleNativeDragOver = (event: DragEvent) => {
      if (
        !hasFileDragType(event.dataTransfer) &&
        !(
          event.dataTransfer?.types?.includes("text/plain") ||
          event.dataTransfer?.types?.includes("text/uri-list")
        )
      ) {
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }
    };

    const handleNativeDrop = (event: DragEvent) => {
      const paths = readDroppedPathsFromDataTransfer(event.dataTransfer);
      if (paths.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      insertDroppedPaths(paths);
      terminal.focus();
    };

    root.addEventListener("dragenter", handleNativeDragOver, true);
    root.addEventListener("dragover", handleNativeDragOver, true);
    root.addEventListener("drop", handleNativeDrop, true);

    return () => {
      root.removeEventListener(
        FILE_PATH_DROP_EVENT,
        handleCustomPathDrop as EventListener,
      );
      root.removeEventListener("dragenter", handleNativeDragOver, true);
      root.removeEventListener("dragover", handleNativeDragOver, true);
      root.removeEventListener("drop", handleNativeDrop, true);
    };
  }, [terminal]);

  return (
    <div
      className="w-full h-full p-4 flex justify-center items-center"
      style={{ background: terminalTheme.background }}
      ref={terminalContainerRef}
      data-file-drop-zone="true"
      data-file-drop-kind="terminal"
      onDragEnter={(event) => {
        if (
          !hasFileDragType(event.dataTransfer) &&
          !(
            event.dataTransfer.types.includes("text/plain") ||
            event.dataTransfer.types.includes("text/uri-list")
          )
        ) {
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDragOver={(event) => {
        if (
          !hasFileDragType(event.dataTransfer) &&
          !(
            event.dataTransfer.types.includes("text/plain") ||
            event.dataTransfer.types.includes("text/uri-list")
          )
        ) {
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDragOverCapture={(event) => {
        if (
          !hasFileDragType(event.dataTransfer) &&
          !(
            event.dataTransfer.types.includes("text/plain") ||
            event.dataTransfer.types.includes("text/uri-list")
          )
        ) {
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDrop={(event) => {
        const paths = readDroppedPathsFromDataTransfer(event.dataTransfer);
        if (paths.length === 0) return;
        event.preventDefault();
        insertDroppedPaths(paths);
        terminal.focus();
      }}
      onDropCapture={(event) => {
        const paths = readDroppedPathsFromDataTransfer(event.dataTransfer);
        if (paths.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        insertDroppedPaths(paths);
        terminal.focus();
      }}
    >
      <div ref={terminalRef} className="w-full h-full"></div>
      {resizeMessage !== "" ? (
        <div className="absolute top-0 bottom-0 left-0 right-0 flex justify-center items-center pointer-events-none z-40">
          <h3 className="text-xl bg-card rounded-lg p-1 px-4">
            {resizeMessage}
          </h3>
        </div>
      ) : (
        ""
      )}
    </div>
  );
}
