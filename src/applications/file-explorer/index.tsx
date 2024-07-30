"use client";

import { TextEditorApplicationWindow } from "@/app/application-windows";
import { CardBody, CardContainer, CardItem } from "@/components/ui/3d-card";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogClose,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/dialog";
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
import {
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@radix-ui/react-dialog";
import { FilePenIcon, FilePlus2 } from "lucide-react";
import {
  ReactNode,
  ReactPortal,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { IoDocumentTextOutline } from "react-icons/io5";
import { IoDocumentOutline } from "react-icons/io5";
import { RiDeleteBin7Line } from "react-icons/ri";
import { RiEdit2Line } from "react-icons/ri";
import { v4 } from "uuid";

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

export default function FileExplorerApplication() {
  const operatingSystem = UseOperatingSystem();

  const [files, setFiles] = useState<OperatingSystemFile[]>(
    operatingSystem.getFiles()
  );

  useEffect(() => {
    window.addEventListener("storage", (event) => {
      updateFiles();
    });
  }, []);

  function updateFiles() {
    setFiles(operatingSystem.getFiles());
  }

  function editFile(file: OperatingSystemFile) {
    if (file) {
      const identifier = v4();
      const portal = createPortal(
        <TextEditorApplicationWindow file={file} />,
        document.getElementById("operating-system-container") as HTMLDivElement,
        "text_editor_child" + identifier
      );
      setChildWindows([...childWindows, portal]);
    }
  }

  const [childWindows, setChildWindows] = useState<ReactPortal[]>([]);

  return (
    <TooltipProvider>
      <ContextMenu>
        <ContextMenuTrigger>
          <div className="w-full h-full bg-background">
            <div className="w-full p-4 bg-background text-foreground flex flex-row flex-wrap  gap-4">
              {childWindows}
              {files.map((file) => {
                return (
                  <FileExplorerIcon
                    key={file.fileName}
                    editFile={() => {
                      editFile(operatingSystem.getFile(file.fileName)!);
                    }}
                    deleteFile={() => {
                      operatingSystem.deleteFile(file.fileName);
                    }}
                    file={file}
                  />
                );
              })}
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="z-[9999] w-56">
          <ContextMenuItem
            key={1}
            onClick={() => {
              const newFiles = operatingSystem
                .getFiles()
                .filter((file) => file.fileName.includes("new_document"));
              operatingSystem.saveFile(
                `new_document${
                  newFiles.length > 0 ? "_" + newFiles.length : ""
                }.txt`,
                ""
              );
            }}
          >
            Create new text file
            <ContextMenuShortcut>
              <FilePlus2 size={18} />
            </ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </TooltipProvider>
  );
}

function NewFileForm() {
  const operatingSystem = UseOperatingSystem();

  const [fileName, setFileName] = useState<string>("");
  const [contents, setContents] = useState<string>("");

  return (
    <div className="w-full h-fit flex flex-col gap-2">
      <Label>File Name</Label>
      <Input
        type="text"
        placeholder="File name"
        autoComplete="false"
        value={fileName}
        onChange={(event) => {
          setFileName(event.target.value);
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
          }}
        >
          Save
        </Button>
        <Button
          onClick={() => {
            operatingSystem.deleteFile(fileName);
            setContents("");
            setFileName("");
          }}
          disabled={!operatingSystem.fileExists(fileName)}
        >
          Delete
        </Button>
      </div>
    </div>
  );
}

function FileExplorerIconCard({
  file,
  deleteFile,
  editFile,
}: {
  file: OperatingSystemFile;
  deleteFile: () => void;
  editFile: () => void;
}) {
  const [fileName, setFileName] = useState<string>(file.fileName);

  const operatingSystem = UseOperatingSystem();

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.addEventListener("focusout", () => {
        if (!operatingSystem.fileExists(fileName)) {
          operatingSystem.saveFile(fileName, file.contents);
          operatingSystem.deleteFile(file.fileName);
        } else {
          setFileName(file.fileName);
        }
      });
    }
  }, [inputRef]);

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <div className="bg-primary transition-all duration-400 text-white w-fit h-fit px-2 py-4 rounded-xl cursor-pointer">
          <div className="h-[30px] w-20 flex justify-center items-center ">
            {file.fileName.endsWith(".txt") ? (
              <IoDocumentTextOutline size={30} />
            ) : (
              <IoDocumentOutline size={30} />
            )}
          </div>
          <div className="font-medium w-20 text-center overflow-hidden  break-words h-fit">
            <form
              onSubmit={(event) => {
                event.stopPropagation();
                event.preventDefault();

                if (!operatingSystem.fileExists(fileName)) {
                  operatingSystem.saveFile(fileName, file.contents);
                  operatingSystem.deleteFile(file.fileName);
                } else {
                  setFileName(file.fileName);
                }
              }}
            >
              <input
                onClick={(event) => {
                  event.stopPropagation();
                }}
                onChange={(event) => {
                  setFileName(event.target.value);
                }}
                ref={inputRef}
                className="bg-none bg-primary text-center w-full"
                value={fileName}
              ></input>
            </form>
          </div>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className="z-[9999] w-56">
        <ContextMenuItem
          key={1}
          onClick={() => {
            const newFiles = operatingSystem
              .getFiles()
              .filter((file) => file.fileName.includes("new_document"));
            operatingSystem.saveFile(
              `new_document${
                newFiles.length > 0 ? "_" + newFiles.length : ""
              }.txt`,
              ""
            );
          }}
        >
          Create new text file
          <ContextMenuShortcut>
            <FilePlus2 size={18} />
          </ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem
          key={2}
          onClick={(event) => {
            event.stopPropagation();
            if (inputRef.current) {
              setTimeout(() => {
                inputRef.current.focus();
              }, 400);
            }
          }}
        >
          Edit file name
          <ContextMenuShortcut>
            <RiEdit2Line size={18} />
          </ContextMenuShortcut>
        </ContextMenuItem>

        <ContextMenuItem
          key={3}
          onClick={() => {
            deleteFile();
          }}
        >
          Delete
          <ContextMenuShortcut>
            <RiDeleteBin7Line size={18} />
          </ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
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
  if (new Blob([file.contents]).size === 0)
    return (
      <div className="w-fit h-fit">
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              onClick={() => {
                editFile();
              }}
              className="w-fit h-fit"
            >
              <FileExplorerIconCard
                deleteFile={deleteFile}
                editFile={editFile}
                file={file}
              />
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="z-[9999]">
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
    );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="w-fit h-fit">
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div
                onClick={() => {
                  editFile();
                }}
                className="w-fit h-fit"
              >
                <FileExplorerIconCard
                  deleteFile={deleteFile}
                  editFile={editFile}
                  file={file}
                />
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent className="z-[9999]">
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
