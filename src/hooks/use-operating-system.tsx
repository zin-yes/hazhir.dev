import styles from "@/operating-system/application/window/application-window.module.css";

export type ApplicationWindowType =
  | "TERMINAL"
  | "VOXEL_GAME"
  | "TEXT_EDITOR"
  | "UNDEFINED"
  | string;

export interface ApplicationWindowInfo {
  identifier: string;
  type: ApplicationWindowType;
  width: number;
  height: number;
  x: number;
  y: number;
}

export const OperatingSystemFileExtentions = {
  TEXT_DOCUMENT: ".txt",
};

export interface OperatingSystemFile {
  directory: string[];
  fileName: string;
  contents: string;
}

export default function UseOperatingSystem() {
  function getApplicationWindow(
    window: HTMLDivElement | string
  ): ApplicationWindowInfo {
    if (window instanceof HTMLDivElement) {
      const elementBoundingRect = window.getBoundingClientRect();
      return {
        identifier: window.id,
        type: window.getAttribute("applicationType") ?? "UNDEFINED",
        width: elementBoundingRect.width,
        height: elementBoundingRect.height,
        x: elementBoundingRect.x,
        y: elementBoundingRect.y,
      };
    } else {
      const element = document.getElementById(window) as HTMLDivElement;
      if (element) {
        const elementBoundingRect = element.getBoundingClientRect();
        return {
          identifier: element.id,
          type: element.getAttribute("applicationType") ?? "UNDEFINED",
          width: elementBoundingRect.width,
          height: elementBoundingRect.height,
          x: elementBoundingRect.x,
          y: elementBoundingRect.y,
        };
      } else {
        return {
          identifier: "NULL",
          type: "NULL",
          width: 0,
          height: 0,
          x: 0,
          y: 0,
        };
      }
    }
  }

  function getApplicationWindows() {
    const applicationWindows: ApplicationWindowInfo[] = [];
    const applicationWindowElements =
      document.getElementsByClassName("applicationWindow");

    for (let i = 0; i < applicationWindowElements.length; i++) {
      const element = applicationWindowElements[i] as HTMLDivElement;
      applicationWindows.push(getApplicationWindow(element));
    }

    return applicationWindows;
  }

  function setApplicationWindowTitle(identifier: string, title: string) {
    const element = document.getElementById(identifier) as HTMLDivElement;

    if (element) {
      (
        element.getElementsByClassName(styles.titleText)[0] as HTMLDivElement
      ).innerHTML = title;
    }
  }

  function fileExists(directory: string[], fileName: string) {
    const files = getFiles(directory);

    return files.filter((file) => file.fileName == fileName).length > 0;
  }

  function getAbsolutePath(directory: string[], fileName: string) {
    return directory.join("/") + "/" + fileName;
  }

  function saveFile(
    directory: string[],
    fileName: string,
    contents: string
  ): boolean {
    const allFiles = getAllFiles().filter(
      (file) =>
        getAbsolutePath(file.directory, file.fileName) !==
        getAbsolutePath(directory, fileName)
    );

    allFiles.push({ directory, fileName, contents });

    window.localStorage.setItem("files", JSON.stringify(allFiles));
    window.dispatchEvent(new Event("storage"));

    return true;
  }

  function getFiles(directory: string[]): OperatingSystemFile[] {
    let result = JSON.parse(
      window.localStorage.getItem("files") ?? "[]"
    ) as OperatingSystemFile[];

    return result.filter((file) => {
      return file.directory.join("/") === directory.join("/");
    });
  }
  function getAllFiles(): OperatingSystemFile[] {
    return JSON.parse(window.localStorage.getItem("files") ?? "[]");
  }

  function deleteFile(directory: string[], fileName: string): boolean {
    const files: OperatingSystemFile[] = getAllFiles();
    if (
      files.filter(
        (file) =>
          getAbsolutePath(file.directory, file.fileName) ===
          getAbsolutePath(directory, fileName)
      ).length > 0
    ) {
      window.localStorage.setItem(
        "files",
        JSON.stringify(
          files.filter(
            (file) =>
              getAbsolutePath(file.directory, file.fileName) !==
              getAbsolutePath(directory, fileName)
          )
        )
      );
      window.dispatchEvent(new Event("storage"));
      return true;
    }
    window.dispatchEvent(new Event("storage"));
    return false;
  }

  function getFile(
    directory: string[],
    fileName: string
  ): OperatingSystemFile | undefined {
    const result = getAllFiles().filter(
      (file) =>
        getAbsolutePath(file.directory, file.fileName) ===
        getAbsolutePath(directory, fileName)
    );

    if (result.length > 0) return result[0];

    return undefined;
  }

  return {
    getApplicationWindows,
    getApplicationWindow,
    setApplicationWindowTitle,
    getFile,
    getFiles,
    getAllFiles,
    saveFile,
    deleteFile,
    fileExists,
  };
}
