"use client";

import { TextEditorApplicationWindow } from "@/app/application-windows";
import { CardBody, CardContainer, CardItem } from "@/components/ui/3d-card";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import UseOperatingSystem, {
  OperatingSystemFile,
} from "@/hooks/use-operating-system";
import { ReactNode, ReactPortal, useId, useState } from "react";
import { createPortal } from "react-dom";

import { IoDocumentTextOutline } from "react-icons/io5";
import { IoDocumentOutline } from "react-icons/io5";

function humanFileSize(bytes: number, si = false, dp = 1) {
  const thresh = si ? 1000 : 1024;

  if (Math.abs(bytes) < thresh) {
    return bytes + " bytes";
  }

  const units = si
    ? ["kB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"]
    : ["KiB", "MiB", "GiB", "TiB", "PiB", "EiB", "ZiB", "YiB"];
  let u = -1;
  const r = 10 ** dp;

  do {
    bytes /= thresh;
    ++u;
  } while (
    Math.round(Math.abs(bytes) * r) / r >= thresh &&
    u < units.length - 1
  );

  return bytes.toFixed(dp) + " " + units[u];
}

export default function FileExplorerApplication({
  addWindow,
}: {
  addWindow: (node: ReactNode) => void;
}) {
  const operatingSystem = UseOperatingSystem();

  const [files, setFiles] = useState<OperatingSystemFile[]>(
    operatingSystem.getFiles()
  );

  const [fileName, setFileName] = useState<string>("");
  const [contents, setContents] = useState<string>("");

  function updateFiles() {
    setFiles(operatingSystem.getFiles());
  }

  function editFile(file: OperatingSystemFile) {
    const portal = createPortal(
      <TextEditorApplicationWindow file={file} />,
      document.getElementById("operating-system-container") as HTMLDivElement,
      useId()
    );

    setChildWindows([...childWindows, portal]);
  }

  const [childWindows, setChildWindows] = useState<ReactPortal[]>([]);

  return (
    <TooltipProvider>
      <div className="w-full h-full p-4">
        {childWindows}
        <div className="w-full h-fit flex flex-col gap-2">
          <Label>File Name</Label>
          <Input
            type="text"
            placeholder="File name"
            autoComplete="false"
            value={fileName}
            onChange={(event) => {
              setFileName(event.target.value);
              updateFiles();
            }}
          />
          <Label>Contents</Label>
          <Textarea
            placeholder="Contents"
            autoComplete="false"
            value={contents}
            onChange={(event) => {
              setContents(event.target.value);
            }}
          />
          <div className="flex flex-row gap-2">
            <Button
              onClick={() => {
                operatingSystem.saveFile(fileName, contents);
                setContents("");
                setFileName("");
                updateFiles();
              }}
              disabled={operatingSystem.fileExists(fileName)}
            >
              Save
            </Button>
            <Button
              onClick={() => {
                operatingSystem.deleteFile(fileName);
                setContents("");
                setFileName("");
                updateFiles();
              }}
              disabled={!operatingSystem.fileExists(fileName)}
            >
              Delete
            </Button>
          </div>
        </div>
        <div className="w-full h-full py-4 flex flex-row flex-wrap justify-start gap-2 items-start">
          <span>
            {files.filter((file) => {
              return fileName.includes(file.fileName);
            }).length > 0 && "match found"}
          </span>
          <br />
          {files.filter((file) => {
            return fileName.includes(file.fileName);
          }).length === 0
            ? files.map((file) => {
                return (
                  <FileExplorerIcon
                    deleteFile={() => {
                      operatingSystem.deleteFile(file.fileName);
                      updateFiles();
                    }}
                    editFile={() => {
                      editFile(file);
                    }}
                    file={file}
                  />
                );
              })
            : files
                .filter((file) => {
                  return fileName.includes(file.fileName);
                })
                .map((file) => {
                  return (
                    <FileExplorerIcon
                      editFile={() => {
                        editFile(file);
                      }}
                      deleteFile={() => {
                        operatingSystem.deleteFile(file.fileName);
                        updateFiles();
                      }}
                      file={file}
                    />
                  );
                })}
        </div>
      </div>
    </TooltipProvider>
  );
}

function FileExplorerIconCard({ file }: { file: OperatingSystemFile }) {
  return (
    <CardContainer className=" transition-all duration-500 w-fit h-fit mt-[-80px] cursor-pointer">
      <CardBody className="max-w-25 max-h-28 bg-white/15 hover:bg-white/110 backdrop-blur-xl transition-all duration-500 rounded-2xl p-4 flex flex-col gap-2 justify-start items-center hover:scale-105 active:scale-[1.15] active:bg-white/25 text-white">
        <CardItem className="h-[30px] w-20 flex justify-center items-center ">
          {file.fileName.endsWith(".txt") ? (
            <IoDocumentTextOutline size={30} />
          ) : (
            <IoDocumentOutline size={30} />
          )}
        </CardItem>
        <CardItem className="font-medium w-20 text-center overflow-hidden whitespace-nowrap text-ellipsis  break-words h-5">
          {file.fileName}
        </CardItem>
      </CardBody>
    </CardContainer>
  );
}

function FileExplorerIcon({
  file,
  deleteFile,
  editFile,
}: {
  file: OperatingSystemFile;
  deleteFile: () => void;
  editFile: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div>
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div
                onClick={() => {
                  editFile();
                }}
              >
                <FileExplorerIconCard file={file} />
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem
                onClick={() => {
                  deleteFile();
                }}
              >
                Delete
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <p>{humanFileSize(new Blob([file.contents]).size)}</p>
      </TooltipContent>
    </Tooltip>
  );
}
