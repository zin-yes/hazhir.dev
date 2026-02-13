export type ParsedArgs = {
  options: Set<string>;
  positionals: string[];
};

type ParseOptionsConfig = {
  shortToLong?: Record<string, string>;
  longOnly?: string[];
  stopAtDoubleDash?: boolean;
};

export function parseCommandArguments(
  args: string[],
  config?: ParseOptionsConfig
): ParsedArgs {
  const options = new Set<string>();
  const positionals: string[] = [];
  const shortToLong = config?.shortToLong ?? {};
  const longOnly = new Set(config?.longOnly ?? []);
  const stopAtDoubleDash = config?.stopAtDoubleDash ?? true;

  let stopOptionParsing = false;

  for (const arg of args) {
    if (stopOptionParsing) {
      positionals.push(arg);
      continue;
    }

    if (stopAtDoubleDash && arg === "--") {
      stopOptionParsing = true;
      continue;
    }

    if (arg.startsWith("--") && arg.length > 2) {
      const long = arg.slice(2);
      if (longOnly.has(long) || Object.values(shortToLong).includes(long)) {
        options.add(long);
      } else {
        positionals.push(arg);
      }
      continue;
    }

    if (arg.startsWith("-") && arg.length > 1) {
      const shorts = arg.slice(1).split("");
      let validShortGroup = true;

      for (const short of shorts) {
        const mapped = shortToLong[short];
        if (!mapped) {
          validShortGroup = false;
          break;
        }
        options.add(mapped);
      }

      if (!validShortGroup) {
        positionals.push(arg);
      }
      continue;
    }

    positionals.push(arg);
  }

  return { options, positionals };
}
