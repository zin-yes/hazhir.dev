import type { Terminal } from "@xterm/xterm";

import { useSession } from "@/auth/client";
import application, { autocomplete as applicationAutocomplete } from "./application";
import alias, { autocomplete as aliasAutocomplete } from "./alias";
import cat, { autocomplete as catAutocomplete } from "./cat";
import cd, { autocomplete as cdAutocomplete } from "./cd";
import clear, { autocomplete as clearAutocomplete } from "./clear";
import exit, { autocomplete as exitAutocomplete } from "./exit";
import exportCommand, { autocomplete as exportAutocomplete } from "./export";
import help, { autocomplete as helpAutocomplete } from "./help";
import ls, { autocomplete as lsAutocomplete } from "./ls";
import mkdir, { autocomplete as mkdirAutocomplete } from "./mkdir";
import pwd, { autocomplete as pwdAutocomplete } from "./pwd";
import reload, { autocomplete as reloadAutocomplete } from "./reload";
import rm, { autocomplete as rmAutocomplete } from "./rm";
import session, { autocomplete as sessionAutocomplete } from "./session";
import signin, { autocomplete as signinAutocomplete } from "./signin";
import signout, { autocomplete as signoutAutocomplete } from "./signout";
import source, { autocomplete as sourceAutocomplete } from "./source";
import touch, { autocomplete as touchAutocomplete } from "./touch";
import template, { autocomplete as templateAutocomplete } from "./template";

export type CommandCallback = (
  fullCommand: string,
  terminal: Terminal,
  session: ReturnType<typeof useSession>,
  windowIdentifier: string
) => Promise<void>;

export type CommandAutocomplete = (params: {
  args: string[];
  currentIndex: number;
  currentToken: string;
  cwd: string;
}) => string[];

const commandCallbacks: Record<string, CommandCallback> = {
  clear: clear,
  help: help,
  signin: signin,
  signout: signout,
  exit: exit,
  alias: alias,
  export: exportCommand,
  application: application,
  reload: reload,
  session: session,
  ls: ls,
  cd: cd,
  pwd: pwd,
  mkdir: mkdir,
  touch: touch,
  rm: rm,
  cat: cat,
  template: template,
  source: source,
};

export const commandAutoCompletes: Record<string, CommandAutocomplete> = {
  alias: aliasAutocomplete,
  export: exportAutocomplete,
  application: applicationAutocomplete,
  cat: catAutocomplete,
  cd: cdAutocomplete,
  clear: clearAutocomplete,
  exit: exitAutocomplete,
  help: helpAutocomplete,
  ls: lsAutocomplete,
  mkdir: mkdirAutocomplete,
  pwd: pwdAutocomplete,
  reload: reloadAutocomplete,
  rm: rmAutocomplete,
  session: sessionAutocomplete,
  signin: signinAutocomplete,
  signout: signoutAutocomplete,
  source: sourceAutocomplete,
  touch: touchAutocomplete,
  template: templateAutocomplete,
};

export default commandCallbacks;
