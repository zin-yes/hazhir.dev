import { getHomePath } from "@/lib/system-user";

const ENV_STORAGE_KEY = "terminal_env_v1";
const ALIAS_STORAGE_KEY = "terminal_aliases_v1";

function readMap(key: string): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const stored = window.localStorage.getItem(key);
    if (!stored) return {};
    return JSON.parse(stored) as Record<string, string>;
  } catch {
    return {};
  }
}

function writeMap(key: string, value: Record<string, string>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

export function getAllEnv(): Record<string, string> {
  const env = readMap(ENV_STORAGE_KEY);
  if (!env.HOME) env.HOME = getHomePath();
  if (!env.PATH) env.PATH = "/applications";
  return env;
}

export function getEnvVar(name: string): string | undefined {
  return getAllEnv()[name];
}

export function setEnvVar(name: string, value: string) {
  const env = getAllEnv();
  env[name] = value;
  writeMap(ENV_STORAGE_KEY, env);
}

export function getAliases(): Record<string, string> {
  return readMap(ALIAS_STORAGE_KEY);
}

export function setAlias(name: string, value: string) {
  const aliases = getAliases();
  aliases[name] = value;
  writeMap(ALIAS_STORAGE_KEY, aliases);
}

export function removeAlias(name: string) {
  const aliases = getAliases();
  delete aliases[name];
  writeMap(ALIAS_STORAGE_KEY, aliases);
}
