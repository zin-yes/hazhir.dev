import { WALLPAPERS } from "@/lib/wallpapers";

export const IMAGE_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "webp",
  "ico",
] as const;

export const IMAGES_DIRECTORY_NAME = "Images";

export function isImageFileName(fileName: string): boolean {
  const ext = fileName.split(".").pop()?.toLowerCase();
  return Boolean(
    ext && IMAGE_EXTENSIONS.includes(ext as (typeof IMAGE_EXTENSIONS)[number]),
  );
}

export function getWallpaperFileNameFromUrl(url: string): string {
  const normalized = url.split("?")[0].split("#")[0];
  return normalized.split("/").pop() || "wallpaper.jpg";
}

export function getImagesDirectoryPath(homePath: string): string {
  return `${homePath}/${IMAGES_DIRECTORY_NAME}`;
}

export function getWallpaperImageEntries(homePath: string) {
  const imagesDirectoryPath = getImagesDirectoryPath(homePath);

  return WALLPAPERS.map((wallpaper) => {
    const name = getWallpaperFileNameFromUrl(wallpaper.url);

    return {
      name,
      label: wallpaper.label,
      url: wallpaper.url,
      path: `${imagesDirectoryPath}/${name}`,
      parentPath: imagesDirectoryPath,
    };
  });
}
