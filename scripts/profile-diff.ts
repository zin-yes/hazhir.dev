/**
 * Diffs two game profiles (snapshot reports or benchmark results) and writes
 * `.profiles/latest-diff.md`.
 *
 *   bun scripts/profile-diff.ts <base> <current>
 *
 * Each argument is a JSON path, `latest` (.profiles/latest-benchmark.json) or
 * `baseline:<name>` (.profiles/baselines/<name>.json).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { diffProfiles, renderDiffMarkdown, type DiffInput } from "../src/applications/game/profiler/diff";

const PROFILE_DIRECTORY_NAME = ".profiles";
const BASELINE_NAME_PATTERN = /^[a-z0-9-]{1,40}$/;
const BASELINE_PREFIX = "baseline:";
const LATEST_SHORTCUT = "latest";

export function resolveProfileArgument(argument: string, workingDirectory: string): string {
  const profileDirectory = path.join(workingDirectory, PROFILE_DIRECTORY_NAME);
  if (argument === LATEST_SHORTCUT) return path.join(profileDirectory, "latest-benchmark.json");
  if (argument.startsWith(BASELINE_PREFIX)) {
    const name = argument.slice(BASELINE_PREFIX.length);
    if (!BASELINE_NAME_PATTERN.test(name)) {
      throw new Error(`Baseline name "${name}" must match ${BASELINE_NAME_PATTERN}`);
    }
    return path.join(profileDirectory, "baselines", `${name}.json`);
  }
  return path.resolve(workingDirectory, argument);
}

async function readProfile(argument: string, workingDirectory: string): Promise<DiffInput> {
  const filePath = resolveProfileArgument(argument, workingDirectory);
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as DiffInput;
  } catch (error) {
    throw new Error(`Could not read a profile from ${filePath}: ${(error as Error).message}`);
  }
}

export async function runProfileDiff(baseArgument: string, currentArgument: string, workingDirectory: string) {
  const [base, current] = await Promise.all([
    readProfile(baseArgument, workingDirectory),
    readProfile(currentArgument, workingDirectory),
  ]);
  const markdown = renderDiffMarkdown(diffProfiles(base, current));
  const outputDirectory = path.join(workingDirectory, PROFILE_DIRECTORY_NAME);
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(path.join(outputDirectory, "latest-diff.md"), markdown);
  return markdown;
}

if (import.meta.main) {
  const [baseArgument, currentArgument] = process.argv.slice(2);
  if (!baseArgument || !currentArgument) {
    console.error("Usage: bun scripts/profile-diff.ts <base.json|latest|baseline:name> <current.json|latest|baseline:name>");
    process.exit(1);
  }
  runProfileDiff(baseArgument, currentArgument, process.cwd())
    .then((markdown) => console.log(markdown))
    .catch((error: Error) => {
      console.error(error.message);
      process.exit(1);
    });
}
