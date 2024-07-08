"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Terminal } from "@xterm/xterm";
import { signIn, signOut, useSession } from "next-auth/react";
import figlet from "figlet";
import chalk from "chalk";
import lodash from "lodash";

export default function MockTerminalApplication() {
  const [resizeMessage, setResizeMessage] = useState<string>("");
  let debouncedReszieMessage = "";
  const setResizeMessageDebounced = lodash.debounce(
    (value: string) => setResizeMessage(value),
    600
  );

  useEffect(() => {
    if (resizeMessage !== "") {
      setTimeout(() => {
        setResizeMessage("");
        setResizeMessageDebounced("");
      }, 600);
    }
  }, [debouncedReszieMessage]);

  const terminal = useMemo<Terminal>(() => {
    return new Terminal({
      fontSize: 18,
      theme: {
        background: "rgba(0,0,0,0)",
      },
    });
  }, []);

  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const terminalResizeObserver = useMemo<ResizeObserver>(
    () =>
      new ResizeObserver(
        (entries: ResizeObserverEntry[], observer: ResizeObserver) => {
          const columns = Math.floor(entries[0].contentRect.width / 10.7);
          const rows = Math.ceil(entries[0].contentRect.height / 20);

          if (terminal) {
            terminal.resize(columns, rows);
          }

          setResizeMessage(`${columns} x ${rows}`);
          setResizeMessageDebounced("");
        }
      ),
    [terminal]
  );

  const { data: session, status } = useSession();

  useEffect(() => {
    if (terminalContainerRef.current) {
      terminalResizeObserver.observe(terminalContainerRef.current);
    }
    if (terminalRef.current && !terminal.element) {
      terminal.options = {
        fontSize: 18,
      };
      terminal.open(terminalRef.current);
      figlet(
        "hazhir.dev",
        {
          font: "Mini",
          horizontalLayout: "default",
          verticalLayout: "default",
          width: terminal.cols,
          whitespaceBreak: true,
        },
        function (err, data) {
          if (err) {
            console.error("Something went wrong...");
            console.dir(err);
            return;
          }

          data!.split("\n").forEach((item) => {
            terminal.writeln(item);
          });

          terminal.writeln(
            `For a list of commands type ${chalk.blue(
              "'help'"
            )} and press enter.`
          );
          terminal.writeln("");
          terminal.write(prefix);
        }
      );

      let prefix = "";
      if (status === "authenticated") {
        prefix = session!.user.name!.replaceAll(" ", "_") + " $ ";
      } else {
        prefix = "$ ";
      }

      terminal.onKey((event) => {
        if (event.domEvent.key === "UpArrow") {
        } else if (event.domEvent.key === "DownArrow") {
        } else if (event.domEvent.key === "Enter") {
          terminal.writeln("");

          let line = terminal.buffer.active
            .getLine(terminal.buffer.active.cursorY)
            ?.translateToString()
            .trim();
          line = line?.substring(prefix.length, line.length);

          // TODO: Create a proper A.P.I for implementing new commands.
          if (line === "clear") {
            setTimeout(() => {
              terminal.clear();
            }, 10);
          } else if (line === "signout") {
            signOut();
          } else if (line === "signin") {
            signIn("/operating-system");
          } else if (line === "sessioninfo") {
            terminal.writeln("");
            if (status === "authenticated") {
              JSON.stringify(session, null, 2)
                .split("\n")
                .map((item) => {
                  terminal.writeln(item);
                });
            } else {
              terminal.writeln(
                "There is no valid session at the current moment. Use \u001b[31m'signin'\u001b[37m to create one."
              );
            }
            terminal.writeln("");
          } else if (line === "help") {
            // TODO: Auto generate the commands from a JSON file.
            terminal.writeln("");
            terminal.writeln(
              `${"─".repeat((terminal.cols - 6) / 2)} help ${"─".repeat(
                (terminal.cols - 6) / 2
              )}`
            );
            terminal.writeln("clear - clear all of the text");
            terminal.writeln("calculator - start the calculator app");
            terminal.writeln("settings - start the settings app");
            terminal.writeln("signin - redirects you to a sign in page");
            terminal.writeln("signout - signs you out");
            terminal.writeln(
              "sessioninfo - prints the current auth. session's info"
            );
            terminal.writeln("");
          } else if (line === "calculator") {
            terminal.writeln("");
            terminal.writeln(
              "This command will start the calculator app in future versions, but for now it just prints this text."
            );
            terminal.writeln("");
          } else if (line === "settings") {
            terminal.writeln("");
            terminal.writeln(
              "This command will start the settings app in future versions, but for now it just prints this text."
            );
            terminal.writeln("");
          } else {
            terminal.writeln("Unknown command.");
            terminal.writeln("");
          }

          terminal.write(prefix);
        } else if (event.domEvent.key === "Backspace") {
          if (terminal.buffer.active.cursorX == 0) {
            terminal.write("[A");
            terminal.write(
              "[C".repeat(
                terminal.buffer.active
                  .getLine(terminal.buffer.active.cursorY)!
                  .translateToString()
                  .trimEnd().length
              )
            );
          } else {
            terminal.write("\b \b");
          }
        } else {
          terminal.write(event.key);
        }
      });
    }
  }, [
    terminalContainerRef,
    terminalRef,
    session,
    status,
    terminal,
    terminalResizeObserver,
  ]);

  return (
    <div
      className="w-full h-full bg-card p-4 flex justify-start items-start"
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
