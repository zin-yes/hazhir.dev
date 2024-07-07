"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Terminal } from "@xterm/xterm";

export default function MockTerminalApplication() {
  const [resizeMessage, setResizeMessage] = useState<string>("");
  const terminal = new Terminal({ fontSize: 18 });

  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const terminalResizeObserver = new ResizeObserver(
    (entries: ResizeObserverEntry[], observer: ResizeObserver) => {
      const columns = Math.floor(entries[0].contentRect.width / 10.7);
      const rows = Math.ceil(entries[0].contentRect.height / 20);

      // TODO: Resize XTERM
      if (terminal) {
        terminal.resize(columns, rows);
      }

      setResizeMessage(`${columns} x ${rows}`);
    }
  );

  useEffect(() => {
    if (terminalContainerRef.current) {
      terminalResizeObserver.observe(terminalContainerRef.current);
    }
    if (terminalRef.current && !terminal.element) {
      terminal.options = {
        fontSize: 18,
      };
      terminal.open(terminalRef.current);
      terminal.writeln(
        "This is a very simple terminal emulator application. Try typing."
      );
      terminal.onKey((event) => {
        console.log(event.domEvent);

        if (event.domEvent.key == "Enter") {
          terminal.writeln("");
        } else if (event.domEvent.key == "Backspace") {
          terminal.write("\b \b");
        } else if (
          event.domEvent.shiftKey ||
          event.domEvent.altKey ||
          event.domEvent.ctrlKey ||
          event.domEvent.metaKey
        ) {
        } else {
          terminal.write(event.key);
        }
      });
    }
  }, [terminalContainerRef, terminalRef]);

  useEffect(() => {
    // FIXME: Make the timeout work so that it doesn't still go thru if its not the "last resize"
    if (resizeMessage !== "") {
      setTimeout(() => {
        setResizeMessage("");
      }, 600);
    }
  }, [resizeMessage]);

  return (
    <div
      className="w-full h-full bg-black p-4 flex justify-center items-center"
      ref={terminalContainerRef}
    >
      <div ref={terminalRef}></div>
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
