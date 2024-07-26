interface ApplicationWindowInfo {
  identifier: string;
  width: number;
  height: number;
  x: number;
  y: number;
}

export default function useOperatingSystem() {
  function getApplicationWindows() {
    const applicationWindows: ApplicationWindowInfo[] = [];
    const applicationWindowElements =
      document.getElementsByClassName("applicationWindow");

    for (let i = 0; i < applicationWindowElements.length; i++) {
      const element = applicationWindowElements[i] as HTMLDivElement;

      applicationWindows.push({
        identifier: element.id,
        width: 0,
        height: 0,
        x: 0,
        y: 0,
      });
    }

    return applicationWindows;
  }

  return { getApplicationWindows };
}
