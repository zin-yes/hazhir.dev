export type ApplicationWindowType =
  | "TERMINAL"
  | "VOXEL_GAME"
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

export default function useOperatingSystem() {
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

  return { getApplicationWindows, getApplicationWindow };
}
