// Sizes of the Terralith data files the game bundles into its generation worker. Headless tools only (reads the disk).

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DataFileSize } from "./worldgen-detail-report";

export function readTerralithDataFileSizes(): DataFileSize[] | undefined {
  try {
    const dataDirectory = fileURLToPath(new URL("../terralith/data", import.meta.url));
    return readdirSync(dataDirectory)
      .filter((fileName) => fileName.endsWith(".json"))
      .map((fileName) => ({ fileName, bytes: statSync(join(dataDirectory, fileName)).size }))
      .sort((left, right) => right.bytes - left.bytes);
  } catch {
    return undefined;
  }
}
