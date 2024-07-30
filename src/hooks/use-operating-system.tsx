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

  function fileExists(fileName: string) {
    const files = getFiles();

    return files.filter((file) => file.fileName == fileName).length > 0;
  }

  function saveFile(fileName: string, contents: string): boolean {
    let files: OperatingSystemFile[] = getFiles().filter(
      (file) => file.fileName !== fileName
    );

    files.push({ fileName, contents });

    window.localStorage.setItem("files", JSON.stringify(files));
    window.dispatchEvent(new Event("storage"));

    return true;
  }

  function getFiles(): OperatingSystemFile[] {
    return JSON.parse(window.localStorage.getItem("files") ?? "[]");
  }

  function deleteFile(fileName: string): boolean {
    const files: OperatingSystemFile[] = getFiles();
    if (files.filter((file) => file.fileName == fileName).length > 0) {
      window.localStorage.setItem(
        "files",
        JSON.stringify(files.filter((file) => file.fileName !== fileName))
      );
      window.dispatchEvent(new Event("storage"));
      return true;
    }
    return false;
  }

  function getFile(fileName: string): OperatingSystemFile | undefined {
    const files: OperatingSystemFile[] = getFiles();

    const result = files.filter((file) => file.fileName === fileName);

    if (result.length > 0) return result[0];

    return undefined;
  }

  return {
    getApplicationWindows,
    getApplicationWindow,
    setApplicationWindowTitle,
    getFile,
    getFiles,
    saveFile,
    deleteFile,
    fileExists,
  };
}
