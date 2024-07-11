"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { ITheme, Terminal } from "@xterm/xterm";
import lodash from "lodash";
import { useTheme } from "next-themes";

import { FitAddon } from "@xterm/addon-fit";

import themes from "./themes.json";

import { COMMAND_LINE_PREFIX, parseCommand } from "./command-line-routine";

export default function TerminalApplication() {
  const [resizeMessage, setResizeMessage] = useState<string>("");

  // TODO: Rewrite debounce resize message.
  let debouncedReszieMessage = "";
  const setResizeMessageDebounced = lodash.debounce(
    (value: string) => setResizeMessage(value),
    600
  );

  const { systemTheme: theme } = useTheme();

  const terminalTheme: ITheme = theme === "dark" ? themes.dark : themes.light;

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
    [terminal, fitAddon]
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

  useEffect(() => {
    if (terminalContainerRef.current && terminalRef.current) {
      if (!initialized.current) {
        initialized.current = true;
        terminalResizeObserver.observe(terminalContainerRef.current);

        terminal.loadAddon(fitAddon);
        terminal.open(terminalRef.current);

        fitAddon.fit();

        terminal.write(COMMAND_LINE_PREFIX);

        terminal.onKey((event) => {
          parseCommand(terminal, event);
        });

        terminal.onData(() => {});
      }
    }
  }, [
    terminalContainerRef,
    terminalRef,
    terminal,
    fitAddon,
    terminalResizeObserver,
  ]);

  return (
    <div
      className="w-full h-full p-4 flex justify-center items-center"
      style={{ background: terminalTheme.background }}
      ref={terminalContainerRef}
    >
      <div ref={terminalRef} className="w-full h-full"></div>
      {resizeMessage !== "" ? (
        <div className="absolute top-0 bottom-0 left-0 right-0 flex justify-center items-center pointer-events-none z-40  bg-[${terminalTheme.background}]">
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
