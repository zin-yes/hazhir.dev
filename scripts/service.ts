#!/usr/bin/env bun

import chalk from "chalk";
import { Command } from "commander";
import fg from "fast-glob";
import { existsSync, promises as fs } from "fs";
import inquirer from "inquirer";
import ora from "ora";
import path from "path";

const program = new Command();

type LintLevel = "error" | "warning";

type LintIssue = {
  level: LintLevel;
  rule: string;
  message: string;
  suggestion?: string;
  file?: string;
};

type OutputFormat = "text" | "json";

type FileActionType = "write" | "overwrite" | "skip" | "update";

type FileAction = {
  type: FileActionType;
  file: string;
  reason?: string;
};

type OperationResult = {
  command: string;
  success: boolean;
  dryRun: boolean;
  actions: FileAction[];
  warnings: string[];
  errors: string[];
  meta?: Record<string, unknown>;
};

type RuleMetadata = {
  id: string;
  level: LintLevel;
  autofixable: boolean;
  description: string;
  guideSection: string;
};

type ScaffoldingOptions = {
  name?: string;
  modules?: string[];
  procedure?: string;
  force?: boolean;
  dryRun?: boolean;
  format?: OutputFormat;
  skipRouter?: boolean;
  skipInput?: boolean;
  skipSchema?: boolean;
  skipRepository?: boolean;
  skipService?: boolean;
};

const workspaceRoot = resolveWorkspaceRoot();
const canonicalServicesRoot = path.resolve(
  workspaceRoot,
  "src",
  "server",
  "features",
);
const legacyServicesRoot = path.resolve(workspaceRoot, "src", "services");
const servicesRoot = resolveServicesRoot();
const adaptersRoot = path.resolve(workspaceRoot, "src", "server", "adapters");
const packageJsonPath = path.resolve(workspaceRoot, "package.json");

function resolveServicesRoot() {
  if (existsSync(canonicalServicesRoot)) {
    return canonicalServicesRoot;
  }

  if (existsSync(legacyServicesRoot)) {
    return legacyServicesRoot;
  }

  return canonicalServicesRoot;
}

function resolveWorkspaceRoot() {
  const cwd = path.resolve(process.cwd());
  const candidateRoots = new Set<string>([cwd]);

  const scriptArg = process.argv[1];
  if (scriptArg) {
    const scriptPath = path.resolve(scriptArg);
    const scriptDir = path.dirname(scriptPath);
    candidateRoots.add(scriptDir);
    candidateRoots.add(path.resolve(scriptDir, ".."));
  }

  for (const candidate of candidateRoots) {
    const discoveredRoot = findProjectRoot(candidate);
    if (discoveredRoot) {
      return discoveredRoot;
    }
  }

  return cwd;
}

function findProjectRoot(startDir: string) {
  let currentDir = path.resolve(startDir);

  while (true) {
    if (isProjectRoot(currentDir)) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }

    currentDir = parentDir;
  }
}

function isProjectRoot(dir: string) {
  const packageJson = path.join(dir, "package.json");
  const featureRoot = path.join(dir, "src", "server", "features");
  const srcRoot = path.join(dir, "src");

  return (
    existsSync(packageJson) && (existsSync(featureRoot) || existsSync(srcRoot))
  );
}

const MODULE_IMPORT_MARKER = "// <service:module-imports>";
const MODULE_PROPERTIES_MARKER = "// <service:module-properties>";
const MODULE_INIT_MARKER = "// <service:module-init>";
const MODULE_CONSTRUCTOR_PARAMS_MARKER =
  "// <service:module-constructor-params>";
const ROUTER_IMPORT_MARKER = "// <service:router-imports>";
const ROUTER_PROPERTIES_MARKER = "// <service:router-properties>";

const LINT_RULES: Record<string, RuleMetadata> = {
  "structure.service-file": {
    id: "structure.service-file",
    level: "error",
    autofixable: false,
    description:
      "Each top-level service folder must contain a <service>.service.ts file.",
    guideSection: "Folder/File Structure",
  },
  "structure.types-file": {
    id: "structure.types-file",
    level: "warning",
    autofixable: false,
    description:
      "Each service/module folder should include a <name>.types.ts file for shared domain types.",
    guideSection: "Type Definitions",
  },
  "router.input.required": {
    id: "router.input.required",
    level: "error",
    autofixable: false,
    description: "Routers require a corresponding input file for validators.",
    guideSection: "Seperation of Concerns",
  },
  "router.service.required": {
    id: "router.service.required",
    level: "error",
    autofixable: false,
    description:
      "Routers should call a service layer and therefore require a service file.",
    guideSection: "Seperation of Concerns",
  },
  "repository.schema.recommended": {
    id: "repository.schema.recommended",
    level: "warning",
    autofixable: false,
    description:
      "Repository usage should normally be paired with a schema file.",
    guideSection: "Seperation of Concerns",
  },
  "service.repository.missing": {
    id: "service.repository.missing",
    level: "warning",
    autofixable: false,
    description:
      "Services referencing repositories should have a repository file.",
    guideSection: "Best Practices",
  },
  "structure.module.service-file": {
    id: "structure.module.service-file",
    level: "error",
    autofixable: false,
    description:
      "Each nested module folder must contain a module service file.",
    guideSection: "Nesting Services",
  },
  "module.exports.instance": {
    id: "module.exports.instance",
    level: "warning",
    autofixable: true,
    description:
      "Nested module services should export classes, not singleton instances.",
    guideSection: "Nesting Services",
  },
  "module.exposure.parent": {
    id: "module.exposure.parent",
    level: "warning",
    autofixable: true,
    description:
      "Nested modules should be accessible only via parent service properties.",
    guideSection: "Nesting Services",
  },
  "router.module.parent-access": {
    id: "router.module.parent-access",
    level: "warning",
    autofixable: true,
    description:
      "Nested routers should call nested services via parent service access path.",
    guideSection: "Router Nesting",
  },
  "router.module.exposure.parent": {
    id: "router.module.exposure.parent",
    level: "warning",
    autofixable: true,
    description: "Nested routers should be mounted on the parent router.",
    guideSection: "Router Nesting",
  },
  "structure.module.location": {
    id: "structure.module.location",
    level: "warning",
    autofixable: false,
    description: "Module files should live inside their own module folders.",
    guideSection: "Nesting Services",
  },
  "structure.nonstandard-file": {
    id: "structure.nonstandard-file",
    level: "warning",
    autofixable: false,
    description:
      "Service/module directories should mostly contain standard <name>.* files. Non-standard files should be reviewed.",
    guideSection: "Folder/File Structure",
  },
  "structure.root.legacy": {
    id: "structure.root.legacy",
    level: "warning",
    autofixable: false,
    description:
      "Legacy service root src/services is in use. Migrate services to src/server/features for full canonical compliance.",
    guideSection: "Migration Checklist",
  },
  "adapter.location": {
    id: "adapter.location",
    level: "warning",
    autofixable: false,
    description:
      "Adapters should live under src/server/adapters and be imported from @/server/adapters/...",
    guideSection: "Adapter Organization",
  },
  "adapter.folder.file": {
    id: "adapter.folder.file",
    level: "warning",
    autofixable: false,
    description:
      "Adapter files should use the .adapter.ts suffix under src/server/adapters.",
    guideSection: "Adapter Organization",
  },
  "di.adapter.constructor": {
    id: "di.adapter.constructor",
    level: "warning",
    autofixable: false,
    description:
      "Services importing adapters should inject adapter dependencies through constructor parameters.",
    guideSection: "Dependency Injection",
  },
  "di.repository.db": {
    id: "di.repository.db",
    level: "warning",
    autofixable: false,
    description:
      "Repositories importing db should inject db through constructor dependency parameters.",
    guideSection: "Dependency Injection",
  },
  "di.logger.constructor": {
    id: "di.logger.constructor",
    level: "warning",
    autofixable: false,
    description:
      "Classes using Logger should inject logger via constructor dependency parameters.",
    guideSection: "Dependency Injection",
  },
  "di.logger.field-new": {
    id: "di.logger.field-new",
    level: "warning",
    autofixable: false,
    description:
      "Avoid logger class-field initialization with new Logger(...); use constructor injection instead.",
    guideSection: "Dependency Injection",
  },
  "server-cli-only.first-line": {
    id: "server-cli-only.first-line",
    level: "error",
    autofixable: true,
    description:
      "Service and repository files must begin with the configured server-cli-only import.",
    guideSection: "Checklist",
  },
  "logger.required": {
    id: "logger.required",
    level: "error",
    autofixable: false,
    description: "Service and repository files must include a logger.",
    guideSection: "Best Practices",
  },
  "logger.instance": {
    id: "logger.instance",
    level: "warning",
    autofixable: false,
    description: "A logger instance should be created inside each class.",
    guideSection: "Best Practices",
  },
  "logger.debug": {
    id: "logger.debug",
    level: "warning",
    autofixable: false,
    description:
      "Methods should include verbose debug logs for params/results.",
    guideSection: "Best Practices",
  },
  "logger.error": {
    id: "logger.error",
    level: "warning",
    autofixable: false,
    description: "Methods should log error paths before throwing.",
    guideSection: "Best Practices",
  },
  "logging.jts": {
    id: "logging.jts",
    level: "warning",
    autofixable: false,
    description: "Logs should serialize objects using jts().",
    guideSection: "Best Practices",
  },
  "params.object": {
    id: "params.object",
    level: "warning",
    autofixable: false,
    description: "Method signatures should accept a params object.",
    guideSection: "Best Practices",
  },
  "di.constructor.params": {
    id: "di.constructor.params",
    level: "warning",
    autofixable: false,
    description:
      "Service constructors should inject dependencies directly via constructor parameters, not a params object.",
    guideSection: "Dependency Injection",
  },
  "di.constructor.inline-new": {
    id: "di.constructor.inline-new",
    level: "warning",
    autofixable: false,
    description:
      "Avoid unconditional dependency creation inside constructor bodies; prefer constructor parameter defaults like private readonly dep: Dep = new Dep().",
    guideSection: "Dependency Injection",
  },
  "router.input": {
    id: "router.input",
    level: "error",
    autofixable: false,
    description: "Router procedures must use .input(...) validation.",
    guideSection: "Router Nesting",
  },
  "input.zod": {
    id: "input.zod",
    level: "warning",
    autofixable: false,
    description: "Input files should use Zod validators.",
    guideSection: "Seperation of Concerns",
  },
  "input.validators": {
    id: "input.validators",
    level: "warning",
    autofixable: false,
    description: "Input files should export validator constants.",
    guideSection: "Seperation of Concerns",
  },
  "input.validators.naming": {
    id: "input.validators.naming",
    level: "warning",
    autofixable: false,
    description: "Validator names should use the Validator suffix.",
    guideSection: "Best Practices",
  },
  "schema.exports": {
    id: "schema.exports",
    level: "warning",
    autofixable: false,
    description: "Schema files should export schema definitions.",
    guideSection: "Seperation of Concerns",
  },
};

program
  .name("service")
  .description(
    "Comprehensive CLI for scaffolding services and sub-services that follow docs/service-guide.md best practices.",
  )
  .showHelpAfterError()
  .addHelpText(
    "after",
    `\nExamples:\n  $ bun scripts/service.ts create --name activity\n  $ bun scripts/service.ts create --name backlog --modules pages,items\n  $ bun scripts/service.ts add-module --service backlog --module pages\n  $ bun scripts/service.ts lint\n\nNotes:\n- The CLI prefers the logger import path detected in your project (e.g. @/lib/logger).\n- The server-cli-only import is picked from package.json if available.\n- Skipping generated files is a best-practice violation; the CLI will ask for confirmation.\n`,
  );

program
  .command("create")
  .description(
    "Scaffold a new service folder with service, repository, router, input, and schema files. Optionally add sub-services (modules) too.",
  )
  .option("-n, --name <name>", "Service name (kebab-case recommended).")
  .option("-m, --modules <list>", "Comma-separated list of module names.")
  .option(
    "-p, --procedure <name>",
    "TRPC procedure to use (e.g. protectedProcedure, publicProcedure).",
  )
  .option("--skip-router", "Skip creating the router file (not recommended).")
  .option("--skip-input", "Skip creating the input file (not recommended).")
  .option("--skip-schema", "Skip creating the schema file (not recommended).")
  .option(
    "--skip-repository",
    "Skip creating the repository file (not recommended).",
  )
  .option("--skip-service", "Skip creating the service file (not recommended).")
  .option("-f, --force", "Overwrite existing files.")
  .option("-d, --dry-run", "Preview changes without writing files.")
  .option("--format <format>", "Output format: text | json", "text")
  .action(async (options: ScaffoldingOptions) => {
    await runCreateService(options);
  })
  .addHelpText(
    "after",
    `\nDetails:\n- Creates a feature folder in src/server/features/<feature>.\n- Includes boilerplate CRUD methods with best-practice logging.\n- Generates a <feature>.types.ts file for shared domain types.\n- Generates module folders in src/server/features/<feature>/<module>.\n- Optionally skips files, but will confirm because it's a best-practice violation.\n`,
  );

program
  .command("add-module")
  .description(
    "Add a sub-service module to an existing service (creates module files and wires them into the parent service when possible).",
  )
  .option(
    "-s, --service <name>",
    "Existing service name (folder in src/server/features).",
  )
  .option("-m, --module <name>", "Module name (kebab-case recommended).")
  .option("-f, --force", "Overwrite existing module files.")
  .option("-d, --dry-run", "Preview changes without writing files.")
  .option("--format <format>", "Output format: text | json", "text")
  .action(
    async (options: {
      service?: string;
      module?: string;
      force?: boolean;
      dryRun?: boolean;
      format?: OutputFormat;
    }) => {
      await runAddModule(options);
    },
  )
  .addHelpText(
    "after",
    `\nDetails:\n- Creates module files under src/server/features/<service>/<module>.\n- Attempts to wire the module into the parent service using markers.\n- If markers aren't present, it will ask before attempting a heuristic update.\n`,
  );

program
  .command("add-submodule")
  .description(
    "Add a sub-module to an existing module (creates files under the module folder).",
  )
  .option(
    "-s, --service <name>",
    "Existing service name (folder in src/server/features).",
  )
  .option(
    "-m, --module <name>",
    "Existing module name (folder in src/server/features/<service>).",
  )
  .option("-u, --submodule <name>", "Sub-module name (kebab-case recommended).")
  .option("-f, --force", "Overwrite existing sub-module files.")
  .option("-d, --dry-run", "Preview changes without writing files.")
  .option("--format <format>", "Output format: text | json", "text")
  .action(
    async (options: {
      service?: string;
      module?: string;
      submodule?: string;
      force?: boolean;
      dryRun?: boolean;
      format?: OutputFormat;
    }) => {
      await runAddSubmodule(options);
    },
  )
  .addHelpText(
    "after",
    `\nDetails:\n- Creates sub-module files under src/server/features/<service>/<module>/<submodule>.\n- Does not auto-wire into the module service (keep modules as explicit dependencies).\n`,
  );

program
  .command("lint")
  .description(
    "Lint all services for service-guide.md best practices (structure, logging, naming, router validation, and more).",
  )
  .option("--format <format>", "Output format: text | json", "text")
  .option("--strict", "Treat warnings as errors (non-zero exit code).")
  .action(async (options: { format: "text" | "json"; strict?: boolean }) => {
    await runLint(options);
  })
  .addHelpText(
    "after",
    `\nRules enforced include:\n- Required file structure (service/router/repository/input/schema).\n- Configured server-cli-only import on first line of service/repository files.\n- Logger presence and debug/error usage.\n- Params object pattern in function signatures.\n- Dependency injection rules: di.constructor.params, di.constructor.inline-new, di.adapter.constructor, di.repository.db, di.logger.constructor, di.logger.field-new.\n- Adapter structure rules: adapter.location, adapter.folder.file.\n- Router uses input validation (.input(...)).\n- Validators exist in input files.\n`,
  );

program
  .command("context")
  .description(
    "Return machine-readable service context for AI workflows (tree, files, and optional lint issues).",
  )
  .option("-s, --service <name>", "Specific service to inspect.")
  .option("--include-lint", "Include lint issues in the output.")
  .option("--format <format>", "Output format: text | json", "json")
  .action(
    async (options: {
      service?: string;
      includeLint?: boolean;
      format?: OutputFormat;
    }) => {
      await runContext(options);
    },
  );

program
  .command("explain-rule")
  .description(
    "Explain a lint rule with guide references for AI remediation loops.",
  )
  .argument("<rule>", "Lint rule id (e.g. server-cli-only.first-line)")
  .option("--format <format>", "Output format: text | json", "text")
  .action(async (rule: string, options: { format?: OutputFormat }) => {
    await runExplainRule(rule, options);
  });

program
  .command("lint-rules")
  .description("List all registered lint rule ids and metadata.")
  .option("--format <format>", "Output format: text | json", "text")
  .action(async (options: { format?: OutputFormat }) => {
    await runListRules(options);
  });

await program.parseAsync(process.argv);

async function runCreateService(options: ScaffoldingOptions) {
  const format = normalizeOutputFormat(options.format);
  const operation: OperationResult = {
    command: "create",
    success: true,
    dryRun: Boolean(options.dryRun),
    actions: [],
    warnings: [],
    errors: [],
    meta: {},
  };

  const packageInfo = await readPackageJsonSafe();
  const detectedServerOnlyImport = detectServerOnlyImport(packageInfo);
  const loggerImportPath = await detectLoggerImportPath();
  const isInteractive = Boolean(process.stdin.isTTY && process.stdout.isTTY);

  const name = options.name ?? (await promptServiceName());
  const normalizedName = normalizeKebab(name);

  if (name !== normalizedName) {
    const confirm = await confirmAction(
      `The provided service name "${name}" is not kebab-case. Use "${normalizedName}" instead?`,
      true,
    );
    if (!confirm) {
      operation.success = false;
      operation.errors.push(
        "Aborted due to non-kebab service name confirmation.",
      );
      emitOperationResult(operation, format);
      await exitWithMessage("Aborted.");
      return;
    }
  }

  const moduleNames =
    options.modules !== undefined
      ? parseModuleOption(options.modules)
      : isInteractive
        ? await promptModuleNames()
        : [];
  const normalizedModules = normalizeAndDedupeKebabNames(moduleNames);

  if (moduleNames.join(",") !== normalizedModules.join(",")) {
    const confirm = await confirmAction(
      "One or more module names were normalized to kebab-case. Continue?",
      true,
    );
    if (!confirm) {
      operation.success = false;
      operation.errors.push(
        "Aborted due to module normalization confirmation.",
      );
      emitOperationResult(operation, format);
      await exitWithMessage("Aborted.");
      return;
    }
  }

  const procedure =
    options.procedure ??
    (isInteractive ? await promptProcedure() : "protectedProcedure");
  const procedureExists = await procedureIsExported(procedure);
  if (!procedureExists) {
    const confirm = await confirmAction(
      `Procedure "${procedure}" was not found in src/server/features/trpc.ts. Continue anyway?`,
      false,
    );
    if (!confirm) {
      operation.success = false;
      operation.errors.push("Aborted due to unknown procedure confirmation.");
      emitOperationResult(operation, format);
      await exitWithMessage("Aborted.");
      return;
    }
  }

  const skipOptions = [
    options.skipInput,
    options.skipSchema,
    options.skipRepository,
    options.skipRouter,
    options.skipService,
  ].some(Boolean);

  if (skipOptions) {
    const confirm = await confirmAction(
      "Skipping files violates the service-guide best practices. Are you sure you want to continue?",
      false,
    );
    if (!confirm) {
      operation.success = false;
      operation.errors.push("Aborted due to skip-file confirmation.");
      emitOperationResult(operation, format);
      await exitWithMessage("Aborted.");
      return;
    }
  }

  const serviceDir = path.join(servicesRoot, normalizedName);
  const filesToWrite = new Map<string, string>();

  if (!options.skipInput) {
    filesToWrite.set(
      path.join(serviceDir, `${normalizedName}.input.ts`),
      renderInputFile(normalizedName),
    );
  }
  filesToWrite.set(
    path.join(serviceDir, `${normalizedName}.types.ts`),
    renderTypesFile(normalizedName),
  );
  if (!options.skipSchema) {
    filesToWrite.set(
      path.join(serviceDir, `${normalizedName}.schema.ts`),
      renderSchemaFile(normalizedName),
    );
  }
  if (!options.skipRepository) {
    filesToWrite.set(
      path.join(serviceDir, `${normalizedName}.repository.ts`),
      renderRepositoryFile({
        featureName: normalizedName,
        className: toPascalCase(normalizedName) + "Repository",
        loggerImportPath,
        serverOnlyImport: detectedServerOnlyImport,
      }),
    );
  }
  if (!options.skipService) {
    filesToWrite.set(
      path.join(serviceDir, `${normalizedName}.service.ts`),
      renderServiceFile({
        featureName: normalizedName,
        className: toPascalCase(normalizedName) + "Service",
        repositoryClassName: toPascalCase(normalizedName) + "Repository",
        loggerImportPath,
        serverOnlyImport: detectedServerOnlyImport,
        modules: normalizedModules,
      }),
    );
  }
  if (!options.skipRouter) {
    filesToWrite.set(
      path.join(serviceDir, `${normalizedName}.router.ts`),
      renderHeadRouterFile({
        featureName: normalizedName,
        procedure,
        serverOnlyImport: detectedServerOnlyImport,
        modules: normalizedModules,
      }),
    );
  }

  for (const moduleName of normalizedModules) {
    const moduleDir = path.join(serviceDir, moduleName);
    filesToWrite.set(
      path.join(moduleDir, `${moduleName}.types.ts`),
      renderTypesFile(moduleName),
    );
    filesToWrite.set(
      path.join(moduleDir, `${moduleName}.input.ts`),
      renderInputFile(moduleName),
    );
    filesToWrite.set(
      path.join(moduleDir, `${moduleName}.schema.ts`),
      renderSchemaFile(moduleName),
    );
    filesToWrite.set(
      path.join(moduleDir, `${moduleName}.repository.ts`),
      renderRepositoryFile({
        featureName: moduleName,
        className: toPascalCase(moduleName) + "Repository",
        loggerImportPath,
        serverOnlyImport: detectedServerOnlyImport,
        exportInstance: false,
      }),
    );
    filesToWrite.set(
      path.join(moduleDir, `${moduleName}.service.ts`),
      renderModuleServiceFile({
        moduleName,
        className: toPascalCase(moduleName) + "Service",
        repositoryClassName: toPascalCase(moduleName) + "Repository",
        loggerImportPath,
        serverOnlyImport: detectedServerOnlyImport,
      }),
    );
    filesToWrite.set(
      path.join(moduleDir, `${moduleName}.router.ts`),
      renderNestedRouterFile({
        featureName: moduleName,
        procedure,
        serverOnlyImport: detectedServerOnlyImport,
        parentServiceName: normalizedName,
        serviceAccessPath: [moduleName],
      }),
    );
  }

  operation.meta = {
    service: normalizedName,
    modules: normalizedModules,
    procedure,
  };

  const writeResult = await writeFiles(filesToWrite, {
    force: Boolean(options.force),
    dryRun: Boolean(options.dryRun),
  });
  operation.actions.push(...writeResult.actions);
  operation.success = writeResult.success;

  emitOperationResult(operation, format);
}

async function runAddModule(options: {
  service?: string;
  module?: string;
  force?: boolean;
  dryRun?: boolean;
  format?: OutputFormat;
}) {
  const format = normalizeOutputFormat(options.format);
  const operation: OperationResult = {
    command: "add-module",
    success: true,
    dryRun: Boolean(options.dryRun),
    actions: [],
    warnings: [],
    errors: [],
    meta: {},
  };

  const packageInfo = await readPackageJsonSafe();
  const detectedServerOnlyImport = detectServerOnlyImport(packageInfo);
  const loggerImportPath = await detectLoggerImportPath();

  const serviceName =
    options.service ?? (await promptServiceName("Existing service name"));
  const normalizedService = normalizeKebab(serviceName);
  const moduleName = options.module ?? (await promptModuleName());
  const normalizedModule = normalizeKebab(moduleName);

  if (serviceName !== normalizedService || moduleName !== normalizedModule) {
    const confirm = await confirmAction(
      `Names were normalized to kebab-case. Continue with ${normalizedService}/${normalizedModule}?`,
      true,
    );
    if (!confirm) {
      operation.success = false;
      operation.errors.push("Aborted due to normalization confirmation.");
      emitOperationResult(operation, format);
      await exitWithMessage("Aborted.");
      return;
    }
  }

  const serviceDir = path.join(servicesRoot, normalizedService);
  const moduleDir = path.join(serviceDir, normalizedModule);
  const filesToWrite = new Map<string, string>();

  if (!(await pathExists(serviceDir))) {
    operation.success = false;
    operation.errors.push(
      `Service folder not found: ${path.relative(workspaceRoot, serviceDir)}`,
    );
    emitOperationResult(operation, format);
    console.log(
      chalk.red(
        `Service folder not found: ${path.relative(workspaceRoot, serviceDir)}`,
      ),
    );
    process.exitCode = 1;
    return;
  }

  filesToWrite.set(
    path.join(moduleDir, `${normalizedModule}.types.ts`),
    renderTypesFile(normalizedModule),
  );
  filesToWrite.set(
    path.join(moduleDir, `${normalizedModule}.input.ts`),
    renderInputFile(normalizedModule),
  );
  filesToWrite.set(
    path.join(moduleDir, `${normalizedModule}.schema.ts`),
    renderSchemaFile(normalizedModule),
  );
  filesToWrite.set(
    path.join(moduleDir, `${normalizedModule}.repository.ts`),
    renderRepositoryFile({
      featureName: normalizedModule,
      className: toPascalCase(normalizedModule) + "Repository",
      loggerImportPath,
      serverOnlyImport: detectedServerOnlyImport,
      exportInstance: false,
    }),
  );
  filesToWrite.set(
    path.join(moduleDir, `${normalizedModule}.service.ts`),
    renderModuleServiceFile({
      moduleName: normalizedModule,
      className: toPascalCase(normalizedModule) + "Service",
      repositoryClassName: toPascalCase(normalizedModule) + "Repository",
      loggerImportPath,
      serverOnlyImport: detectedServerOnlyImport,
    }),
  );
  filesToWrite.set(
    path.join(moduleDir, `${normalizedModule}.router.ts`),
    renderNestedRouterFile({
      featureName: normalizedModule,
      procedure: "protectedProcedure",
      serverOnlyImport: detectedServerOnlyImport,
      parentServiceName: normalizedService,
      serviceAccessPath: [normalizedModule],
    }),
  );

  const writeResult = await writeFiles(filesToWrite, {
    force: Boolean(options.force),
    dryRun: Boolean(options.dryRun),
  });
  operation.actions.push(...writeResult.actions);
  operation.success = writeResult.success;

  const serviceFile = path.join(serviceDir, `${normalizedService}.service.ts`);
  const serviceWireActions = await wireModulesIntoService({
    serviceFile,
    modules: [normalizedModule],
    dryRun: Boolean(options.dryRun),
  });
  operation.actions.push(...serviceWireActions);

  const parentRouterFile = path.join(
    serviceDir,
    `${normalizedService}.router.ts`,
  );
  const routerWireActions = await wireNestedRoutersIntoRouter({
    routerFile: parentRouterFile,
    modules: [normalizedModule],
    dryRun: Boolean(options.dryRun),
  });
  operation.actions.push(...routerWireActions);

  operation.meta = {
    service: normalizedService,
    module: normalizedModule,
  };

  emitOperationResult(operation, format);
}

async function runAddSubmodule(options: {
  service?: string;
  module?: string;
  submodule?: string;
  force?: boolean;
  dryRun?: boolean;
  format?: OutputFormat;
}) {
  const format = normalizeOutputFormat(options.format);
  const operation: OperationResult = {
    command: "add-submodule",
    success: true,
    dryRun: Boolean(options.dryRun),
    actions: [],
    warnings: [],
    errors: [],
    meta: {},
  };

  const packageInfo = await readPackageJsonSafe();
  const detectedServerOnlyImport = detectServerOnlyImport(packageInfo);
  const loggerImportPath = await detectLoggerImportPath();

  const serviceName =
    options.service ?? (await promptServiceName("Existing service name"));
  const normalizedService = normalizeKebab(serviceName);
  const moduleName = options.module ?? (await promptModuleName());
  const normalizedModule = normalizeKebab(moduleName);
  const submoduleName = options.submodule ?? (await promptSubmoduleName());
  const normalizedSubmodule = normalizeKebab(submoduleName);

  if (
    serviceName !== normalizedService ||
    moduleName !== normalizedModule ||
    submoduleName !== normalizedSubmodule
  ) {
    const confirm = await confirmAction(
      `Names were normalized to kebab-case. Continue with ${normalizedService}/${normalizedModule}/${normalizedSubmodule}?`,
      true,
    );
    if (!confirm) {
      operation.success = false;
      operation.errors.push("Aborted due to normalization confirmation.");
      emitOperationResult(operation, format);
      await exitWithMessage("Aborted.");
      return;
    }
  }

  const serviceDir = path.join(servicesRoot, normalizedService);
  const moduleDir = path.join(serviceDir, normalizedModule);
  const submoduleDir = path.join(moduleDir, normalizedSubmodule);
  const filesToWrite = new Map<string, string>();

  if (!(await pathExists(serviceDir))) {
    operation.success = false;
    operation.errors.push(
      `Service folder not found: ${path.relative(workspaceRoot, serviceDir)}`,
    );
    emitOperationResult(operation, format);
    console.log(
      chalk.red(
        `Service folder not found: ${path.relative(workspaceRoot, serviceDir)}`,
      ),
    );
    process.exitCode = 1;
    return;
  }

  if (!(await pathExists(moduleDir))) {
    operation.success = false;
    operation.errors.push(
      `Module folder not found: ${path.relative(workspaceRoot, moduleDir)}`,
    );
    emitOperationResult(operation, format);
    console.log(
      chalk.red(
        `Module folder not found: ${path.relative(workspaceRoot, moduleDir)}`,
      ),
    );
    process.exitCode = 1;
    return;
  }

  filesToWrite.set(
    path.join(submoduleDir, `${normalizedSubmodule}.types.ts`),
    renderTypesFile(normalizedSubmodule),
  );
  filesToWrite.set(
    path.join(submoduleDir, `${normalizedSubmodule}.input.ts`),
    renderInputFile(normalizedSubmodule),
  );
  filesToWrite.set(
    path.join(submoduleDir, `${normalizedSubmodule}.schema.ts`),
    renderSchemaFile(normalizedSubmodule),
  );
  filesToWrite.set(
    path.join(submoduleDir, `${normalizedSubmodule}.repository.ts`),
    renderRepositoryFile({
      featureName: normalizedSubmodule,
      className: toPascalCase(normalizedSubmodule) + "Repository",
      loggerImportPath,
      serverOnlyImport: detectedServerOnlyImport,
      exportInstance: false,
    }),
  );
  filesToWrite.set(
    path.join(submoduleDir, `${normalizedSubmodule}.service.ts`),
    renderModuleServiceFile({
      moduleName: normalizedSubmodule,
      className: toPascalCase(normalizedSubmodule) + "Service",
      repositoryClassName: toPascalCase(normalizedSubmodule) + "Repository",
      loggerImportPath,
      serverOnlyImport: detectedServerOnlyImport,
    }),
  );
  filesToWrite.set(
    path.join(submoduleDir, `${normalizedSubmodule}.router.ts`),
    renderNestedRouterFile({
      featureName: normalizedSubmodule,
      procedure: "protectedProcedure",
      serverOnlyImport: detectedServerOnlyImport,
      parentServiceName: normalizedService,
      serviceAccessPath: [normalizedModule, normalizedSubmodule],
    }),
  );

  const writeResult = await writeFiles(filesToWrite, {
    force: Boolean(options.force),
    dryRun: Boolean(options.dryRun),
  });
  operation.actions.push(...writeResult.actions);
  operation.success = writeResult.success;

  const moduleServiceFile = path.join(
    moduleDir,
    `${normalizedModule}.service.ts`,
  );
  const serviceWireActions = await wireModulesIntoService({
    serviceFile: moduleServiceFile,
    modules: [normalizedSubmodule],
    dryRun: Boolean(options.dryRun),
  });
  operation.actions.push(...serviceWireActions);

  const moduleRouterFile = path.join(
    moduleDir,
    `${normalizedModule}.router.ts`,
  );
  const routerWireActions = await wireNestedRoutersIntoRouter({
    routerFile: moduleRouterFile,
    modules: [normalizedSubmodule],
    dryRun: Boolean(options.dryRun),
  });
  operation.actions.push(...routerWireActions);

  operation.meta = {
    service: normalizedService,
    module: normalizedModule,
    submodule: normalizedSubmodule,
  };

  emitOperationResult(operation, format);
}

async function runLint(options: { format: "text" | "json"; strict?: boolean }) {
  const packageInfo = await readPackageJsonSafe();
  const detectedServerOnlyImport = detectServerOnlyImport(packageInfo);
  const loggerImportPath = await detectLoggerImportPath();

  const issues: LintIssue[] = [];

  collectServiceRootIssues(issues);

  const serviceDirs = await getServiceDirectories();

  for (const serviceDir of serviceDirs) {
    const serviceName = path.basename(serviceDir);
    const serviceFile = path.join(serviceDir, `${serviceName}.service.ts`);
    const repositoryFile = path.join(
      serviceDir,
      `${serviceName}.repository.ts`,
    );
    const routerFile = path.join(serviceDir, `${serviceName}.router.ts`);
    const typesFile = path.join(serviceDir, `${serviceName}.types.ts`);
    const inputFile = path.join(serviceDir, `${serviceName}.input.ts`);
    const schemaFile = path.join(serviceDir, `${serviceName}.schema.ts`);

    const serviceExists = await pathExists(serviceFile);
    const repositoryExists = await pathExists(repositoryFile);
    const routerExists = await pathExists(routerFile);
    const typesExists = await pathExists(typesFile);
    const inputExists = await pathExists(inputFile);
    const schemaExists = await pathExists(schemaFile);

    if (!typesExists) {
      issues.push({
        level: "warning",
        rule: "structure.types-file",
        message: "Missing types file for this feature.",
        suggestion:
          "Add a <service>.types.ts file for shared domain types used across layers.",
        file: typesFile,
      });
    }

    if (!serviceExists) {
      issues.push({
        level: "error",
        rule: "structure.service-file",
        message: "Missing service file for this feature.",
        suggestion: "Add the service file so the feature exposes a public API.",
        file: serviceFile,
      });
    }

    if (routerExists && !inputExists) {
      issues.push({
        level: "error",
        rule: "router.input.required",
        message: "Router exists but no input file was found.",
        suggestion:
          "Create an input file and add validators used by the router.",
        file: inputFile,
      });
    }

    if (routerExists && !serviceExists) {
      issues.push({
        level: "error",
        rule: "router.service.required",
        message: "Router exists but no service file was found.",
        suggestion: "Create a service file and ensure the router calls it.",
        file: serviceFile,
      });
    }

    if (repositoryExists && !schemaExists) {
      issues.push({
        level: "warning",
        rule: "repository.schema.recommended",
        message: "Repository exists but schema file is missing.",
        suggestion: "Add a schema file if the repository touches the database.",
        file: schemaFile,
      });
    }

    if (serviceExists && !repositoryExists) {
      const serviceContent = await fs.readFile(serviceFile, "utf8");
      if (
        serviceContent.includes("Repository") ||
        serviceContent.includes(".repository")
      ) {
        issues.push({
          level: "warning",
          rule: "service.repository.missing",
          message:
            "Service references a repository, but no repository file was found.",
          suggestion:
            "Create a repository file or remove repository usage from the service.",
          file: repositoryFile,
        });
      }
    }

    const moduleDirs = await getModuleDirectories(serviceDir);
    const parentServiceContent = serviceExists
      ? await fs.readFile(serviceFile, "utf8")
      : null;
    const parentRouterContent = routerExists
      ? await fs.readFile(routerFile, "utf8")
      : null;
    for (const moduleDir of moduleDirs) {
      const moduleName = path.basename(moduleDir);
      const moduleServiceFile = path.join(
        moduleDir,
        `${moduleName}.service.ts`,
      );
      const moduleRepositoryFile = path.join(
        moduleDir,
        `${moduleName}.repository.ts`,
      );
      const moduleRouterFile = path.join(moduleDir, `${moduleName}.router.ts`);
      const moduleTypesFile = path.join(moduleDir, `${moduleName}.types.ts`);
      const moduleInputFile = path.join(moduleDir, `${moduleName}.input.ts`);
      const moduleSchemaFile = path.join(moduleDir, `${moduleName}.schema.ts`);

      const moduleServiceExists = await pathExists(moduleServiceFile);
      const moduleRepositoryExists = await pathExists(moduleRepositoryFile);
      const moduleRouterExists = await pathExists(moduleRouterFile);
      const moduleTypesExists = await pathExists(moduleTypesFile);
      const moduleInputExists = await pathExists(moduleInputFile);
      const moduleSchemaExists = await pathExists(moduleSchemaFile);

      if (!moduleTypesExists) {
        issues.push({
          level: "warning",
          rule: "structure.types-file",
          message: "Missing types file for this module.",
          suggestion:
            "Add a <module>.types.ts file for shared domain types used across layers.",
          file: moduleTypesFile,
        });
      }

      if (!moduleServiceExists) {
        issues.push({
          level: "error",
          rule: "structure.module.service-file",
          message: "Missing module service file.",
          suggestion: "Create the module service so the parent can expose it.",
          file: moduleServiceFile,
        });
      }

      if (moduleRouterExists && !moduleInputExists) {
        issues.push({
          level: "error",
          rule: "router.input.required",
          message: "Module router exists but no input file was found.",
          suggestion:
            "Create an input file and add validators used by the module router.",
          file: moduleInputFile,
        });
      }

      if (moduleRouterExists && !moduleServiceExists) {
        issues.push({
          level: "error",
          rule: "router.service.required",
          message: "Module router exists but no service file was found.",
          suggestion:
            "Create a module service file and ensure the router calls it.",
          file: moduleServiceFile,
        });
      }

      if (moduleRepositoryExists && !moduleSchemaExists) {
        issues.push({
          level: "warning",
          rule: "repository.schema.recommended",
          message: "Module repository exists but schema file is missing.",
          suggestion:
            "Add a schema file if the module repository touches the database.",
          file: moduleSchemaFile,
        });
      }

      if (moduleServiceExists && !moduleRepositoryExists) {
        const moduleServiceContent = await fs.readFile(
          moduleServiceFile,
          "utf8",
        );
        if (
          moduleServiceContent.includes("Repository") ||
          moduleServiceContent.includes(".repository")
        ) {
          issues.push({
            level: "warning",
            rule: "service.repository.missing",
            message:
              "Module service references a repository, but no repository file was found.",
            suggestion:
              "Create a repository file or remove repository usage from the module service.",
            file: moduleRepositoryFile,
          });
        }
      }

      if (moduleServiceExists) {
        const moduleServiceContent = await fs.readFile(
          moduleServiceFile,
          "utf8",
        );
        if (
          /export\s+const\s+\w+Service\s*=\s*new\s+\w+Service\s*\(/.test(
            moduleServiceContent,
          )
        ) {
          issues.push({
            level: "warning",
            rule: "module.exports.instance",
            message: "Module service exports an instance directly.",
            suggestion:
              "Export the class only and let the parent service create the instance.",
            file: moduleServiceFile,
          });
        }
      }

      if (parentServiceContent) {
        const moduleClassName = `${toPascalCase(moduleName)}Service`;
        const moduleProperty = toCamelCase(moduleName);
        const hasModuleImport = parentServiceContent.includes(moduleClassName);
        const modulePropertyRegex = new RegExp(
          `public\\s+(readonly\\s+)?${moduleProperty}\\b`,
        );
        const hasModuleProperty =
          modulePropertyRegex.test(parentServiceContent);
        const moduleConstructorParamRegex = new RegExp(
          `public\\s+(readonly\\s+)?${moduleProperty}\\s*:\\s*${moduleClassName}\\s*=\\s*new\\s+${moduleClassName}\\s*\\(`,
        );
        const hasModuleConstructorParam =
          moduleConstructorParamRegex.test(parentServiceContent);
        const moduleInitRegex = new RegExp(
          `this\\.${moduleProperty}\\s*=\\s*(?:params\\.${moduleProperty}\\s*\\?\\?\\s*)?new\\s+${moduleClassName}\\s*\\(`,
        );
        const hasModuleInit = moduleInitRegex.test(parentServiceContent);

        const hasModuleExposure =
          hasModuleProperty || hasModuleConstructorParam;
        const hasModuleInjection = hasModuleInit || hasModuleConstructorParam;

        if (!hasModuleImport || !hasModuleExposure || !hasModuleInjection) {
          issues.push({
            level: "warning",
            rule: "module.exposure.parent",
            message:
              "Module exists but is not exposed through the parent service.",
            suggestion:
              "Import the module service and expose/inject it via constructor dependency parameters or explicit constructor initialization.",
            file: serviceFile,
          });
        }
      }

      if (moduleRouterExists) {
        const moduleRouterContent = await fs.readFile(moduleRouterFile, "utf8");

        if (moduleRouterContent.includes(`./${moduleName}.service`)) {
          issues.push({
            level: "warning",
            rule: "router.module.parent-access",
            message:
              "Module router should call the nested module through the parent service, not import its own service file.",
            suggestion:
              "Import the parent service and call parentService.<module>.<method>(...).",
            file: moduleRouterFile,
          });
        }
      }

      if (parentRouterContent && moduleRouterExists) {
        const moduleRouterName = `${toCamelCase(moduleName)}Router`;
        const moduleProperty = toCamelCase(moduleName);
        const hasNestedRouterImport =
          parentRouterContent.includes(moduleRouterName);
        const hasNestedRouterProperty = parentRouterContent.includes(
          `${moduleProperty}: ${moduleRouterName}`,
        );

        if (!hasNestedRouterImport || !hasNestedRouterProperty) {
          issues.push({
            level: "warning",
            rule: "router.module.exposure.parent",
            message:
              "Module router exists but is not exposed through the parent router.",
            suggestion:
              "Import the module router and expose it as a nested property on the parent router.",
            file: routerFile,
          });
        }
      }
    }

    const misplacedModuleFiles = await detectMisplacedModuleFiles(
      serviceDir,
      serviceName,
    );
    for (const misplaced of misplacedModuleFiles) {
      issues.push({
        level: "warning",
        rule: "structure.module.location",
        message:
          "Sub-module files are nested directly under the parent service folder.",
        suggestion:
          "Move module files into a dedicated module folder so they are only accessed through the parent service.",
        file: misplaced,
      });
    }

    const unexpectedServiceFiles = await detectUnexpectedServiceFiles(
      serviceDir,
      serviceName,
    );
    for (const unexpectedFile of unexpectedServiceFiles) {
      issues.push({
        level: "warning",
        rule: "structure.nonstandard-file",
        message:
          "Non-standard file detected in service folder. Prefer the standard <name>.types/input/schema/router/repository/service files and move specialized data logic into an appropriate module when possible.",
        suggestion:
          "If this is intentional, leave it as-is. Otherwise, refactor it into the standard service structure.",
        file: unexpectedFile,
      });
    }

    await collectAdapterStructureIssues({
      baseDir: serviceDir,
      issues,
    });

    for (const moduleDir of moduleDirs) {
      const moduleName = path.basename(moduleDir);
      const unexpectedModuleFiles = await detectUnexpectedServiceFiles(
        moduleDir,
        moduleName,
      );
      for (const unexpectedFile of unexpectedModuleFiles) {
        issues.push({
          level: "warning",
          rule: "structure.nonstandard-file",
          message:
            "Non-standard file detected in module folder. Prefer the standard <name>.types/input/schema/router/repository/service files and keep extra files only when they are genuinely needed.",
          suggestion:
            "If this is intentional, leave it as-is. Otherwise, merge or relocate it into the standard module structure.",
          file: unexpectedFile,
        });
      }

      await collectAdapterStructureIssues({
        baseDir: moduleDir,
        issues,
      });
    }
  }

  const serviceAndRepositoryFiles = await fg(
    ["**/*.service.ts", "**/*.repository.ts"],
    {
      cwd: servicesRoot,
      absolute: true,
    },
  );

  for (const file of serviceAndRepositoryFiles) {
    const content = await fs.readFile(file, "utf8");
    const firstImport = getFirstImportLine(content);

    const allowedServerOnlyImports = ["server-cli-only", "server-only"];
    const hasAllowedImport = allowedServerOnlyImports.some((value) =>
      firstImport?.includes(value),
    );

    if (!hasAllowedImport) {
      issues.push({
        level: "error",
        rule: "server-cli-only.first-line",
        message: `First import should be import \"${detectedServerOnlyImport}\";`,
        suggestion:
          "Move the server-cli-only import to the first line of the file.",
        file,
      });
    } else if (!firstImport?.includes(detectedServerOnlyImport)) {
      issues.push({
        level: "warning",
        rule: "server-cli-only.first-line",
        message: `First import should match the configured server-cli-only package (\"${detectedServerOnlyImport}\").`,
        suggestion:
          "Update the first import to use the configured server-cli-only package.",
        file,
      });
    }

    if (!content.includes("Logger")) {
      issues.push({
        level: "error",
        rule: "logger.required",
        message: "Logger import/usage not found.",
        suggestion: "Import Logger and create an instance in the class.",
        file,
      });
    } else if (!content.includes("new Logger(")) {
      issues.push({
        level: "warning",
        rule: "logger.instance",
        message: "Logger instance not found in class.",
        suggestion: "Create a Logger instance to log debug and error messages.",
        file,
      });
    }

    if (!content.includes("logger.debug")) {
      issues.push({
        level: "warning",
        rule: "logger.debug",
        message: "No debug logging detected.",
        suggestion: "Add verbose debug logs showing params and results.",
        file,
      });
    }

    if (!content.includes("logger.error")) {
      issues.push({
        level: "warning",
        rule: "logger.error",
        message: "No error logging detected.",
        suggestion: "Log errors before throwing to aid troubleshooting.",
        file,
      });
    }

    if (!content.includes("jts(")) {
      issues.push({
        level: "warning",
        rule: "logging.jts",
        message: "jts() not used in logging.",
        suggestion: "Use jts() to serialize params and results in logs.",
        file,
      });
    }

    const methodMatches = content.matchAll(
      /async\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)/g,
    );
    for (const match of methodMatches) {
      const params = match[2]?.trim() ?? "";
      if (params.length > 0 && !params.startsWith("params")) {
        issues.push({
          level: "warning",
          rule: "params.object",
          message: `Method "${match[1]}" should accept a params object as its first argument.`,
          suggestion: "Change the signature to accept a params object.",
          file,
        });
      }
    }

    if (file.endsWith(".service.ts")) {
      const constructorInfo = getConstructorParts(content);
      const importedAdapters = getImportedAdapterNames(content);

      if (constructorInfo) {
        const constructorParams = constructorInfo.params.trim();
        const hasParamsObject = /\bparams\s*(?:\?|:|=|,|\))/m.test(
          constructorParams,
        );
        const hasDependencyParameter =
          /\b(?:private|public|protected)\s+(?:readonly\s+)?\w+\s*:\s*[A-Za-z0-9_]+(?:Service|Repository|Adapter)\b/.test(
            constructorParams,
          );
        const hasDependencyImports =
          /import\s+[^;]*(?:Service|Repository|Adapter)\b[^;]*from\s+["'][^"']+["']/.test(
            content,
          );

        if (
          (hasParamsObject || !hasDependencyParameter) &&
          hasDependencyImports
        ) {
          issues.push({
            level: "warning",
            rule: "di.constructor.params",
            message:
              "Service constructor should inject dependencies directly via constructor parameters.",
            suggestion:
              "Use constructor(private readonly repository: Repo = new Repo(), public module: ModuleService = new ModuleService()) {}.",
            file,
          });
        }

        const hasDirectDependencyNew =
          /this\.\w+\s*=\s*new\s+[A-Za-z0-9_]+(?:Service|Repository|Adapter)\s*\(/.test(
            constructorInfo.body,
          );

        if (hasDirectDependencyNew) {
          issues.push({
            level: "warning",
            rule: "di.constructor.inline-new",
            message:
              "Constructor body creates dependencies directly instead of using constructor parameter defaults.",
            suggestion:
              "Move dependency defaults to constructor parameters, e.g. private readonly repository: Repo = new Repo().",
            file,
          });
        }

        if (importedAdapters.length > 0) {
          const missingAdapterConstructorInjection = importedAdapters.filter(
            (adapterName) =>
              !new RegExp(`:\\s*${adapterName}\\b`).test(constructorParams),
          );

          if (missingAdapterConstructorInjection.length > 0) {
            issues.push({
              level: "warning",
              rule: "di.adapter.constructor",
              message:
                "Service imports adapters but does not inject them via constructor dependency parameters.",
              suggestion: `Inject adapters in constructor parameters: ${missingAdapterConstructorInjection.join(
                ", ",
              )}.`,
              file,
            });
          }
        }
      } else if (importedAdapters.length > 0) {
        issues.push({
          level: "warning",
          rule: "di.adapter.constructor",
          message:
            "Service imports adapters but has no constructor for dependency injection.",
          suggestion:
            "Add a constructor and inject adapters as dependency parameters.",
          file,
        });
      }
    }

    const constructorInfo = getConstructorParts(content);
    const hasLoggerFieldNew =
      /private\s+readonly\s+logger\s*=\s*new\s+Logger\s*\(/.test(content);

    if (constructorInfo) {
      const constructorParams = constructorInfo.params.trim();

      if (
        content.includes("import Logger") &&
        !hasLoggerConstructorInjection(constructorParams)
      ) {
        issues.push({
          level: "warning",
          rule: "di.logger.constructor",
          message:
            "Logger should be injected via constructor dependency parameters.",
          suggestion:
            'Use constructor(private readonly logger: Logger = new Logger("Context"), ...) {}.',
          file,
        });
      }

      if (hasLoggerFieldNew) {
        issues.push({
          level: "warning",
          rule: "di.logger.field-new",
          message:
            "Logger is initialized directly in a class field instead of constructor injection.",
          suggestion:
            "Move logger initialization into constructor dependency parameters.",
          file,
        });
      }

      if (
        file.endsWith(".repository.ts") &&
        hasRepositoryDbImport(content) &&
        !hasDbConstructorInjection(constructorParams)
      ) {
        issues.push({
          level: "warning",
          rule: "di.repository.db",
          message:
            "Repository imports db but does not inject it through constructor dependency parameters.",
          suggestion:
            "Use constructor(private readonly database: typeof db = db, ...) {} and reference this.database in queries.",
          file,
        });
      }
    } else {
      if (content.includes("import Logger")) {
        issues.push({
          level: "warning",
          rule: "di.logger.constructor",
          message:
            "Class uses Logger but has no constructor dependency injection for logger.",
          suggestion: "Add a constructor and inject logger dependency there.",
          file,
        });
      }

      if (file.endsWith(".repository.ts") && hasRepositoryDbImport(content)) {
        issues.push({
          level: "warning",
          rule: "di.repository.db",
          message:
            "Repository imports db but has no constructor dependency injection for db.",
          suggestion:
            "Add a constructor and inject db dependency as a parameter default.",
          file,
        });
      }
    }
  }

  await collectGlobalAdapterStructureIssues(issues);

  const routerFiles = await fg(["**/*.router.ts"], {
    cwd: servicesRoot,
    absolute: true,
  });
  for (const file of routerFiles) {
    const content = await fs.readFile(file, "utf8");
    if (!content.includes(".input(")) {
      issues.push({
        level: "error",
        rule: "router.input",
        message:
          "Router procedures must include input validation via .input(...).",
        suggestion: "Add a validator and wire it with .input(...).",
        file,
      });
    }
  }

  const inputFiles = await fg(["**/*.input.ts"], {
    cwd: servicesRoot,
    absolute: true,
  });
  for (const file of inputFiles) {
    const content = await fs.readFile(file, "utf8");
    if (!content.includes("zod") && !content.includes("z.")) {
      issues.push({
        level: "warning",
        rule: "input.zod",
        message: "Zod not referenced in input validators.",
        suggestion: "Import Zod and define validators for router input.",
        file,
      });
    }

    const exportedZodValidators = getExportedZodValidatorNames(content);

    if (exportedZodValidators.length === 0) {
      issues.push({
        level: "warning",
        rule: "input.validators",
        message: "No exported validators found.",
        suggestion: "Export validators that end with the Validator suffix.",
        file,
      });
    }

    if (exportedZodValidators.some((name) => !name.endsWith("Validator"))) {
      issues.push({
        level: "warning",
        rule: "input.validators.naming",
        message: "Exported validators should end with the Validator suffix.",
        suggestion:
          "Rename validators to end with Validator for consistent detection.",
        file,
      });
    }
  }

  const schemaFiles = await fg(["**/*.schema.ts"], {
    cwd: servicesRoot,
    absolute: true,
  });
  for (const file of schemaFiles) {
    const content = await fs.readFile(file, "utf8");
    if (!content.includes("export")) {
      issues.push({
        level: "warning",
        rule: "schema.exports",
        message: "Schema file has no exports.",
        suggestion: "Export the schema definitions used by the repository.",
        file,
      });
    }
  }

  const output = formatLintOutput(issues, options.format);
  console.log(output);

  const hasErrors = issues.some((issue) => issue.level === "error");
  const hasWarnings = issues.some((issue) => issue.level === "warning");

  if (options.strict && (hasErrors || hasWarnings)) {
    process.exitCode = 1;
    return;
  }

  if (hasErrors) {
    process.exitCode = 1;
  }

  if (issues.length === 0) {
    console.log(chalk.green("✔ All services pass the lint rules."));
  } else {
    console.log(
      chalk.yellow(
        `\nSummary: ${issues.filter((i) => i.level === "error").length} errors, ${
          issues.filter((i) => i.level === "warning").length
        } warnings.`,
      ),
    );
  }
}

function renderInputFile(featureName: string) {
  const pascal = toPascalCase(featureName);
  return `import { z } from "zod";

export const create${pascal}Validator = z.object({});
export const read${pascal}Validator = z.object({});
export const update${pascal}Validator = z.object({});
export const delete${pascal}Validator = z.object({});

export type Create${pascal}Input = z.infer<typeof create${pascal}Validator>;
export type Read${pascal}Input = z.infer<typeof read${pascal}Validator>;
export type Update${pascal}Input = z.infer<typeof update${pascal}Validator>;
export type Delete${pascal}Input = z.infer<typeof delete${pascal}Validator>;
`;
}

function renderTypesFile(featureName: string) {
  const pascal = toPascalCase(featureName);
  const camel = toCamelCase(featureName);
  return `export type ${pascal}Id = string;

export type ${pascal}Record = {
  id: ${pascal}Id;
  createdAt: string;
  updatedAt: string;
};

export type ${pascal}ListResult = {
  items: ${pascal}Record[];
  total: number;
};

export type ${pascal}MutationResult = {
  success: boolean;
  ${camel}?: ${pascal}Record;
};
`;
}

function renderSchemaFile(featureName: string) {
  const tableName = featureName.replace(/-/g, "_");
  return `import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const ${toCamelCase(featureName)}Schema = sqliteTable("${tableName}", {
  id: text("id").primaryKey(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .$defaultFn(() => new Date())
    .notNull(),
});
`;
}

function renderRepositoryFile(params: {
  featureName: string;
  className: string;
  loggerImportPath: string;
  serverOnlyImport: string;
  exportInstance?: boolean;
}) {
  const {
    featureName,
    className,
    loggerImportPath,
    serverOnlyImport,
    exportInstance = true,
  } = params;
  const camel = toCamelCase(featureName);

  return `import "${serverOnlyImport}";

import Logger from "${loggerImportPath}";
import { jts } from "@/lib/utils";

export class ${className} {
  constructor(
    private readonly logger: Logger = new Logger("${className}"),
  ) {}

  public async create(params: Record<string, unknown>) {
    try {
      const result = null as unknown;

      this.logger.debug(\`create(\${jts(params)}) -> \${jts(result)}\`);
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error in create.";

      this.logger.error(\`create(\${jts(params)}): \${errorMessage}\`);
      throw error;
    }
  }

  public async read(params: Record<string, unknown>) {
    try {
      const result = null as unknown;

      this.logger.debug(\`read(\${jts(params)}) -> \${jts(result)}\`);
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error in read.";

      this.logger.error(\`read(\${jts(params)}): \${errorMessage}\`);
      throw error;
    }
  }

  public async update(params: Record<string, unknown>) {
    try {
      const result = null as unknown;

      this.logger.debug(\`update(\${jts(params)}) -> \${jts(result)}\`);
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error in update.";

      this.logger.error(\`update(\${jts(params)}): \${errorMessage}\`);
      throw error;
    }
  }

  public async delete(params: Record<string, unknown>) {
    try {
      const result = null as unknown;

      this.logger.debug(\`delete(\${jts(params)}) -> \${jts(result)}\`);
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error in delete.";

      this.logger.error(\`delete(\${jts(params)}): \${errorMessage}\`);
      throw error;
    }
  }
}

${exportInstance ? `export const ${camel}Repository = new ${className}();\n` : ""}`;
}

function renderServiceFile(params: {
  featureName: string;
  className: string;
  repositoryClassName: string;
  loggerImportPath: string;
  serverOnlyImport: string;
  modules: string[];
}) {
  const {
    featureName,
    className,
    repositoryClassName,
    loggerImportPath,
    serverOnlyImport,
    modules,
  } = params;
  const camel = toCamelCase(featureName);
  const moduleImports = modules
    .map((moduleName) => {
      const moduleClassName = toPascalCase(moduleName) + "Service";
      return `import { ${moduleClassName} } from "./${moduleName}/${moduleName}.service";`;
    })
    .join("\n");

  const moduleConstructorParams = modules
    .map(
      (moduleName) =>
        `    public ${toCamelCase(moduleName)}: ${toPascalCase(moduleName)}Service = new ${toPascalCase(moduleName)}Service(),`,
    )
    .join("\n");

  return `import "${serverOnlyImport}";

import Logger from "${loggerImportPath}";
import { jts } from "@/lib/utils";
import { ${repositoryClassName} } from "./${featureName}.repository";
${MODULE_IMPORT_MARKER}
${moduleImports}

class ${className} {
  constructor(
    private readonly repository: ${repositoryClassName} = new ${repositoryClassName}(),
    private readonly logger: Logger = new Logger("${className}"),
${MODULE_CONSTRUCTOR_PARAMS_MARKER}
${moduleConstructorParams ? moduleConstructorParams + "\n" : ""}  ) {}


  public async create(params: Record<string, unknown>) {
    try {
      const result = await this.repository.create(params);

      this.logger.debug(\`create(\${jts(params)}) -> \${jts(result)}\`);
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error in create.";

      this.logger.error(\`create(\${jts(params)}): \${errorMessage}\`);
      throw error;
    }
  }

  public async read(params: Record<string, unknown>) {
    try {
      const result = await this.repository.read(params);

      this.logger.debug(\`read(\${jts(params)}) -> \${jts(result)}\`);
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error in read.";

      this.logger.error(\`read(\${jts(params)}): \${errorMessage}\`);
      throw error;
    }
  }

  public async update(params: Record<string, unknown>) {
    try {
      const result = await this.repository.update(params);

      this.logger.debug(\`update(\${jts(params)}) -> \${jts(result)}\`);
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error in update.";

      this.logger.error(\`update(\${jts(params)}): \${errorMessage}\`);
      throw error;
    }
  }

  public async delete(params: Record<string, unknown>) {
    try {
      const result = await this.repository.delete(params);

      this.logger.debug(\`delete(\${jts(params)}) -> \${jts(result)}\`);
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error in delete.";

      this.logger.error(\`delete(\${jts(params)}): \${errorMessage}\`);
      throw error;
    }
  }
}

export const ${camel}Service = new ${className}();
`;
}

function renderModuleServiceFile(params: {
  moduleName: string;
  className: string;
  repositoryClassName: string;
  loggerImportPath: string;
  serverOnlyImport: string;
  modules?: string[];
}) {
  const {
    moduleName,
    className,
    repositoryClassName,
    loggerImportPath,
    serverOnlyImport,
    modules = [],
  } = params;

  const moduleImports = modules
    .map((nestedModuleName) => {
      const moduleClassName = toPascalCase(nestedModuleName) + "Service";
      return `import { ${moduleClassName} } from "./${nestedModuleName}/${nestedModuleName}.service";`;
    })
    .join("\n");

  const moduleConstructorParams = modules
    .map(
      (nestedModuleName) =>
        `    public ${toCamelCase(nestedModuleName)}: ${toPascalCase(nestedModuleName)}Service = new ${toPascalCase(nestedModuleName)}Service(),`,
    )
    .join("\n");

  return `import "${serverOnlyImport}";

import Logger from "${loggerImportPath}";
import { jts } from "@/lib/utils";
import { ${repositoryClassName} } from "./${moduleName}.repository";
${MODULE_IMPORT_MARKER}
${moduleImports}

export class ${className} {
  constructor(
    private readonly repository: ${repositoryClassName} = new ${repositoryClassName}(),
    private readonly logger: Logger = new Logger("${className}"),
${MODULE_CONSTRUCTOR_PARAMS_MARKER}
${moduleConstructorParams ? moduleConstructorParams + "\n" : ""}  ) {}


  public async create(params: Record<string, unknown>) {
    try {
      const result = await this.repository.create(params);

      this.logger.debug(\`create(\${jts(params)}) -> \${jts(result)}\`);
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error in create.";

      this.logger.error(\`create(\${jts(params)}): \${errorMessage}\`);
      throw error;
    }
  }

  public async read(params: Record<string, unknown>) {
    try {
      const result = await this.repository.read(params);

      this.logger.debug(\`read(\${jts(params)}) -> \${jts(result)}\`);
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error in read.";

      this.logger.error(\`read(\${jts(params)}): \${errorMessage}\`);
      throw error;
    }
  }

  public async update(params: Record<string, unknown>) {
    try {
      const result = await this.repository.update(params);

      this.logger.debug(\`update(\${jts(params)}) -> \${jts(result)}\`);
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error in update.";

      this.logger.error(\`update(\${jts(params)}): \${errorMessage}\`);
      throw error;
    }
  }

  public async delete(params: Record<string, unknown>) {
    try {
      const result = await this.repository.delete(params);

      this.logger.debug(\`delete(\${jts(params)}) -> \${jts(result)}\`);
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error in delete.";

      this.logger.error(\`delete(\${jts(params)}): \${errorMessage}\`);
      throw error;
    }
  }
}
`;
}

function renderHeadRouterFile(params: {
  featureName: string;
  procedure: string;
  serverOnlyImport: string;
  modules: string[];
}) {
  const { featureName, procedure, serverOnlyImport, modules } = params;
  const pascal = toPascalCase(featureName);
  const camel = toCamelCase(featureName);
  const routerName = `${camel}Router`;
  const moduleImports = modules
    .map((moduleName) => {
      const moduleRouterName = `${toCamelCase(moduleName)}Router`;
      return `import { ${moduleRouterName} } from "./${moduleName}/${moduleName}.router";`;
    })
    .join("\n");

  const moduleRouterProperties = modules
    .map(
      (moduleName) =>
        `  ${toCamelCase(moduleName)}: ${toCamelCase(moduleName)}Router,`,
    )
    .join("\n");

  return `import "${serverOnlyImport}";

import { createTRPCRouter, ${procedure} } from "@/server/features/trpc";
import {
  create${pascal}Validator,
  read${pascal}Validator,
  update${pascal}Validator,
  delete${pascal}Validator,
} from "./${featureName}.input";
import { ${camel}Service } from "./${featureName}.service";
${ROUTER_IMPORT_MARKER}
${moduleImports}

export const ${routerName} = createTRPCRouter({
  create: ${procedure}
    .input(create${pascal}Validator)
    .mutation(async ({ input }) => {
      const result = await ${camel}Service.create(input);
      return result;
    }),
  read: ${procedure}
    .input(read${pascal}Validator)
    .query(async ({ input }) => {
      const result = await ${camel}Service.read(input);
      return result;
    }),
  update: ${procedure}
    .input(update${pascal}Validator)
    .mutation(async ({ input }) => {
      const result = await ${camel}Service.update(input);
      return result;
    }),
  delete: ${procedure}
    .input(delete${pascal}Validator)
    .mutation(async ({ input }) => {
      const result = await ${camel}Service.delete(input);
      return result;
    }),
${ROUTER_PROPERTIES_MARKER}
${moduleRouterProperties ? moduleRouterProperties + "\n" : ""}
});
`;
}

function renderNestedRouterFile(params: {
  featureName: string;
  procedure: string;
  serverOnlyImport: string;
  parentServiceName: string;
  serviceAccessPath: string[];
  nestedRouters?: string[];
}) {
  const {
    featureName,
    procedure,
    serverOnlyImport,
    parentServiceName,
    serviceAccessPath,
    nestedRouters = [],
  } = params;
  const pascal = toPascalCase(featureName);
  const camel = toCamelCase(featureName);
  const routerName = `${camel}Router`;
  const parentService = `${toCamelCase(parentServiceName)}Service`;
  const parentServiceImportPath = buildRelativeImportPath(
    serviceAccessPath.length,
    `${parentServiceName}.service`,
  );
  const serviceAccessor = `${parentService}.${serviceAccessPath
    .map((segment) => toCamelCase(segment))
    .join(".")}`;
  const nestedRouterImports = nestedRouters
    .map((nestedName) => {
      const nestedRouterName = `${toCamelCase(nestedName)}Router`;
      return `import { ${nestedRouterName} } from "./${nestedName}/${nestedName}.router";`;
    })
    .join("\n");
  const nestedRouterProperties = nestedRouters
    .map(
      (nestedName) =>
        `  ${toCamelCase(nestedName)}: ${toCamelCase(nestedName)}Router,`,
    )
    .join("\n");

  return `import "${serverOnlyImport}";

import { createTRPCRouter, ${procedure} } from "@/server/features/trpc";
import {
  create${pascal}Validator,
  read${pascal}Validator,
  update${pascal}Validator,
  delete${pascal}Validator,
} from "./${featureName}.input";
import { ${parentService} } from "${parentServiceImportPath}";
${ROUTER_IMPORT_MARKER}
${nestedRouterImports}

export const ${routerName} = createTRPCRouter({
  create: ${procedure}
    .input(create${pascal}Validator)
    .mutation(async ({ input }) => {
      const result = await ${serviceAccessor}.create(input);
      return result;
    }),
  read: ${procedure}
    .input(read${pascal}Validator)
    .query(async ({ input }) => {
      const result = await ${serviceAccessor}.read(input);
      return result;
    }),
  update: ${procedure}
    .input(update${pascal}Validator)
    .mutation(async ({ input }) => {
      const result = await ${serviceAccessor}.update(input);
      return result;
    }),
  delete: ${procedure}
    .input(delete${pascal}Validator)
    .mutation(async ({ input }) => {
      const result = await ${serviceAccessor}.delete(input);
      return result;
    }),
${ROUTER_PROPERTIES_MARKER}
${nestedRouterProperties ? nestedRouterProperties + "\n" : ""}
});
`;
}

async function wireModulesIntoService(params: {
  serviceFile: string;
  modules: string[];
  dryRun: boolean;
}): Promise<FileAction[]> {
  const { serviceFile, dryRun } = params;
  const modules = normalizeAndDedupeKebabNames(params.modules);

  if (!(await pathExists(serviceFile))) {
    console.log(chalk.red(`Service file not found: ${serviceFile}`));
    return [] as FileAction[];
  }

  const content = await fs.readFile(serviceFile, "utf8");
  if (!content.includes(MODULE_IMPORT_MARKER)) {
    const confirm = await confirmAction(
      "Service file lacks CLI markers for module wiring. Attempt a heuristic update?",
      false,
    );
    if (!confirm) {
      return [] as FileAction[];
    }
    return await heuristicModuleWiring(serviceFile, modules, dryRun);
  }

  const newContent = applyModuleMarkers(content, modules);
  if (newContent === content) {
    return [] as FileAction[];
  }

  if (dryRun) {
    console.log(
      chalk.cyan(
        `Dry run: would update ${path.relative(workspaceRoot, serviceFile)}`,
      ),
    );
    return [
      {
        type: "update",
        file: path.relative(workspaceRoot, serviceFile),
        reason: "dry-run",
      },
    ];
  }

  await fs.writeFile(serviceFile, newContent, "utf8");
  console.log(
    chalk.green(`Updated ${path.relative(workspaceRoot, serviceFile)}`),
  );
  return [
    {
      type: "update",
      file: path.relative(workspaceRoot, serviceFile),
    },
  ];
}

async function wireNestedRoutersIntoRouter(params: {
  routerFile: string;
  modules: string[];
  dryRun: boolean;
}): Promise<FileAction[]> {
  const { routerFile, dryRun } = params;
  const modules = normalizeAndDedupeKebabNames(params.modules);

  if (!(await pathExists(routerFile))) {
    console.log(chalk.red(`Router file not found: ${routerFile}`));
    return [] as FileAction[];
  }

  const content = await fs.readFile(routerFile, "utf8");
  if (!content.includes(ROUTER_IMPORT_MARKER)) {
    const confirm = await confirmAction(
      "Router file lacks CLI markers for nested router wiring. Attempt a heuristic update?",
      false,
    );
    if (!confirm) {
      return [] as FileAction[];
    }
    return await heuristicRouterWiring(routerFile, modules, dryRun);
  }

  const newContent = applyRouterMarkers(content, modules);
  if (newContent === content) {
    return [] as FileAction[];
  }

  if (dryRun) {
    console.log(
      chalk.cyan(
        `Dry run: would update ${path.relative(workspaceRoot, routerFile)}`,
      ),
    );
    return [
      {
        type: "update",
        file: path.relative(workspaceRoot, routerFile),
        reason: "dry-run",
      },
    ];
  }

  await fs.writeFile(routerFile, newContent, "utf8");
  console.log(
    chalk.green(`Updated ${path.relative(workspaceRoot, routerFile)}`),
  );
  return [
    {
      type: "update",
      file: path.relative(workspaceRoot, routerFile),
    },
  ];
}

function applyModuleMarkers(content: string, modules: string[]) {
  const importLines = modules
    .map((moduleName) => {
      const moduleClassName = toPascalCase(moduleName) + "Service";
      return `import { ${moduleClassName} } from "./${moduleName}/${moduleName}.service";`;
    })
    .join("\n");

  const constructorParamLines = modules
    .map(
      (moduleName) =>
        `    public ${toCamelCase(moduleName)}: ${toPascalCase(moduleName)}Service = new ${toPascalCase(moduleName)}Service(),`,
    )
    .join("\n");

  let updated = content;

  updated = mergeAfterMarker(
    updated,
    MODULE_IMPORT_MARKER,
    "\n\n",
    importLines,
  );
  updated = mergeAfterMarker(
    updated,
    MODULE_CONSTRUCTOR_PARAMS_MARKER,
    "\n  )",
    constructorParamLines,
  );

  return updated;
}

function applyRouterMarkers(content: string, modules: string[]) {
  const importLines = modules
    .map((moduleName) => {
      const moduleRouterName = `${toCamelCase(moduleName)}Router`;
      return `import { ${moduleRouterName} } from "./${moduleName}/${moduleName}.router";`;
    })
    .join("\n");

  const propertyLines = modules
    .map(
      (moduleName) =>
        `  ${toCamelCase(moduleName)}: ${toCamelCase(moduleName)}Router,`,
    )
    .join("\n");

  let updated = content;
  updated = mergeAfterMarker(
    updated,
    ROUTER_IMPORT_MARKER,
    "\n\nexport const",
    importLines,
  );
  updated = mergeAfterMarker(
    updated,
    ROUTER_PROPERTIES_MARKER,
    "\n});",
    propertyLines,
  );

  return updated;
}

function mergeAfterMarker(
  content: string,
  marker: string,
  endToken: string,
  addition: string,
) {
  const markerIndex = content.indexOf(marker);
  if (markerIndex === -1) {
    return content;
  }

  const startIndex = markerIndex + marker.length;
  const endIndex = content.indexOf(endToken, startIndex);
  if (endIndex === -1) {
    return content;
  }

  const before = content.slice(0, startIndex);
  const existingBlock = content
    .slice(startIndex, endIndex)
    .replace(/^\n+/, "")
    .replace(/\n+$/, "");
  const after = content.slice(endIndex);
  const existingLines = existingBlock
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);
  const additionLines = addition
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);
  const combined = Array.from(
    new Set([...existingLines, ...additionLines]),
  ).join("\n");

  return `${before}\n${combined}\n${after}`;
}

async function heuristicModuleWiring(
  serviceFile: string,
  modules: string[],
  dryRun: boolean,
): Promise<FileAction[]> {
  const normalizedModules = normalizeAndDedupeKebabNames(modules);
  const content = await fs.readFile(serviceFile, "utf8");
  const importInsertionPoint = content.indexOf("\n\n");
  const constructorIndex = content.indexOf("constructor(");

  if (importInsertionPoint === -1 || constructorIndex === -1) {
    console.log(
      chalk.yellow(
        `Unable to safely auto-wire modules in ${path.relative(workspaceRoot, serviceFile)}.`,
      ),
    );
    return [] as FileAction[];
  }

  const openParenIndex = content.indexOf("(", constructorIndex);
  const closeParenIndex =
    openParenIndex === -1
      ? -1
      : findMatchingToken(content, openParenIndex, "(", ")");

  if (openParenIndex === -1 || closeParenIndex === -1) {
    console.log(
      chalk.yellow(
        `Unable to safely auto-wire modules in ${path.relative(workspaceRoot, serviceFile)}.`,
      ),
    );
    return [] as FileAction[];
  }

  const importLines = normalizedModules
    .map((moduleName) => {
      const moduleClassName = toPascalCase(moduleName) + "Service";
      return `import { ${moduleClassName} } from "./${moduleName}/${moduleName}.service";`;
    })
    .filter((line) => !content.includes(line))
    .join("\n");

  const paramsContent = content.slice(openParenIndex + 1, closeParenIndex);
  const paramIndentMatch = paramsContent.match(/\n(\s*)\S/);
  const paramIndent = paramIndentMatch ? paramIndentMatch[1] : "    ";

  const constructorParamLines = normalizedModules
    .map(
      (moduleName) =>
        `public ${toCamelCase(moduleName)}: ${toPascalCase(moduleName)}Service = new ${toPascalCase(moduleName)}Service(),`,
    )
    .filter((line) => !paramsContent.includes(line));

  if (!importLines && constructorParamLines.length === 0) {
    return [] as FileAction[];
  }

  let updated = content;

  if (importLines) {
    updated =
      updated.slice(0, importInsertionPoint + 2) +
      `${importLines}\n` +
      updated.slice(importInsertionPoint + 2);
  }

  if (constructorParamLines.length > 0) {
    const updatedOpenParenIndex = updated.indexOf("(", constructorIndex);
    const updatedCloseParenIndex =
      updatedOpenParenIndex === -1
        ? -1
        : findMatchingToken(updated, updatedOpenParenIndex, "(", ")");

    if (updatedOpenParenIndex === -1 || updatedCloseParenIndex === -1) {
      return [] as FileAction[];
    }

    const updatedParamsContent = updated.slice(
      updatedOpenParenIndex + 1,
      updatedCloseParenIndex,
    );
    const trailingWhitespaceMatch = updatedParamsContent.match(/\s*$/);
    const trailingWhitespace = trailingWhitespaceMatch
      ? trailingWhitespaceMatch[0]
      : "";
    const paramsWithoutTrailing = updatedParamsContent.slice(
      0,
      updatedParamsContent.length - trailingWhitespace.length,
    );
    const paramsTrimmed = paramsWithoutTrailing.trim();
    const updatedParamIndentMatch = updatedParamsContent.match(/\n(\s*)\S/);
    const updatedParamIndent = updatedParamIndentMatch
      ? updatedParamIndentMatch[1]
      : paramIndent;

    let paramsBase = paramsWithoutTrailing;
    if (paramsTrimmed.length > 0 && !paramsTrimmed.endsWith(",")) {
      paramsBase = paramsWithoutTrailing.trimEnd() + ",";
    }

    if (paramsBase.trim().length > 0 && !paramsBase.endsWith("\n")) {
      paramsBase += "\n";
    }

    const addition = constructorParamLines
      .map((line) => `${updatedParamIndent}${line}`)
      .join("\n");

    const mergedParams = `${paramsBase}${addition}${trailingWhitespace}`;
    updated =
      updated.slice(0, updatedOpenParenIndex + 1) +
      mergedParams +
      updated.slice(updatedCloseParenIndex);
  }

  if (dryRun) {
    console.log(
      chalk.cyan(
        `Dry run: would update ${path.relative(workspaceRoot, serviceFile)}`,
      ),
    );
    return [
      {
        type: "update",
        file: path.relative(workspaceRoot, serviceFile),
        reason: "dry-run",
      },
    ];
  }

  await fs.writeFile(serviceFile, updated, "utf8");
  console.log(
    chalk.green(`Updated ${path.relative(workspaceRoot, serviceFile)}`),
  );
  return [
    {
      type: "update",
      file: path.relative(workspaceRoot, serviceFile),
    },
  ];
}

async function heuristicRouterWiring(
  routerFile: string,
  modules: string[],
  dryRun: boolean,
): Promise<FileAction[]> {
  const normalizedModules = normalizeAndDedupeKebabNames(modules);
  const content = await fs.readFile(routerFile, "utf8");
  const importInsertionPoint = content.indexOf("\n\nexport const");
  const routerObjectClose = content.lastIndexOf("\n});");

  if (importInsertionPoint === -1 || routerObjectClose === -1) {
    console.log(
      chalk.yellow(
        `Unable to safely auto-wire nested routers in ${path.relative(workspaceRoot, routerFile)}.`,
      ),
    );
    return [] as FileAction[];
  }

  const importLines = normalizedModules
    .map((moduleName) => {
      const moduleRouterName = `${toCamelCase(moduleName)}Router`;
      return `import { ${moduleRouterName} } from "./${moduleName}/${moduleName}.router";`;
    })
    .filter((line) => !content.includes(line))
    .join("\n");

  const propertyLines = normalizedModules
    .map(
      (moduleName) =>
        `  ${toCamelCase(moduleName)}: ${toCamelCase(moduleName)}Router,`,
    )
    .filter((line) => !content.includes(line))
    .join("\n");

  if (!importLines && !propertyLines) {
    return [] as FileAction[];
  }

  let updated = content;
  if (importLines) {
    updated =
      updated.slice(0, importInsertionPoint) +
      `${importLines}\n` +
      updated.slice(importInsertionPoint);
  }

  if (propertyLines) {
    const insertionPoint = updated.lastIndexOf("\n});");
    if (insertionPoint === -1) {
      return [] as FileAction[];
    }

    updated =
      updated.slice(0, insertionPoint) +
      `\n${propertyLines}` +
      updated.slice(insertionPoint);
  }

  if (dryRun) {
    console.log(
      chalk.cyan(
        `Dry run: would update ${path.relative(workspaceRoot, routerFile)}`,
      ),
    );
    return [
      {
        type: "update",
        file: path.relative(workspaceRoot, routerFile),
        reason: "dry-run",
      },
    ];
  }

  await fs.writeFile(routerFile, updated, "utf8");
  console.log(
    chalk.green(`Updated ${path.relative(workspaceRoot, routerFile)}`),
  );
  return [
    {
      type: "update",
      file: path.relative(workspaceRoot, routerFile),
    },
  ];
}

async function writeFiles(
  filesToWrite: Map<string, string>,
  options: { force: boolean; dryRun: boolean },
): Promise<{ success: boolean; actions: FileAction[] }> {
  const actions: FileAction[] = [];
  const spinner = ora("Scaffolding files...").start();

  try {
    for (const [filePath, content] of filesToWrite.entries()) {
      const relativePath = path.relative(workspaceRoot, filePath);
      const existedBefore = await pathExists(filePath);

      if (existedBefore) {
        if (!options.force) {
          const confirm = await confirmAction(
            `File already exists: ${relativePath}. Overwrite?`,
            false,
          );
          if (!confirm) {
            spinner.info(`Skipped ${relativePath}`);
            actions.push({
              type: "skip",
              file: relativePath,
              reason: "user-skip",
            });
            continue;
          }
        }
      }

      if (options.dryRun) {
        spinner.info(`Dry run: would write ${relativePath}`);
        actions.push({
          type: existedBefore ? "overwrite" : "write",
          file: relativePath,
          reason: "dry-run",
        });
        continue;
      }

      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, "utf8");
      spinner.info(`Wrote ${relativePath}`);
      actions.push({
        type: existedBefore ? "overwrite" : "write",
        file: relativePath,
      });
    }

    spinner.succeed("Scaffolding complete.");
    return {
      success: true,
      actions,
    };
  } catch (error) {
    spinner.fail("Scaffolding failed.");
    console.error(error);
    process.exitCode = 1;
    return {
      success: false,
      actions,
    };
  }
}

async function promptServiceName(message = "Service name") {
  const { name } = await inquirer.prompt<{ name: string }>([
    {
      type: "input",
      name: "name",
      message,
      validate: (value: string) =>
        value.trim().length ? true : "Service name is required.",
    },
  ]);
  return name.trim();
}

async function promptModuleName() {
  const { name } = await inquirer.prompt<{ name: string }>([
    {
      type: "input",
      name: "name",
      message: "Module name",
      validate: (value: string) =>
        value.trim().length ? true : "Module name is required.",
    },
  ]);
  return name.trim();
}

function parseModuleOption(modules: string | string[]) {
  if (Array.isArray(modules)) {
    return modules.map((moduleName) => moduleName.trim()).filter(Boolean);
  }

  if (!modules.trim()) {
    return [] as string[];
  }

  return modules
    .split(",")
    .map((moduleName) => moduleName.trim())
    .filter(Boolean);
}

async function promptSubmoduleName() {
  const { name } = await inquirer.prompt<{ name: string }>([
    {
      type: "input",
      name: "name",
      message: "Sub-module name",
      validate: (value: string) =>
        value.trim().length ? true : "Sub-module name is required.",
    },
  ]);
  return name.trim();
}

async function promptModuleNames() {
  const { modules } = await inquirer.prompt<{ modules: string }>([
    {
      type: "input",
      name: "modules",
      message: "Comma-separated module names (leave blank for none)",
    },
  ]);

  if (!modules?.trim()) {
    return [] as string[];
  }

  return modules
    .split(",")
    .map((moduleName) => moduleName.trim())
    .filter(Boolean);
}

async function promptProcedure() {
  const { procedure } = await inquirer.prompt<{ procedure: string }>([
    {
      type: "list",
      name: "procedure",
      message: "TRPC procedure to use",
      choices: [
        { name: "protectedProcedure (default)", value: "protectedProcedure" },
        { name: "publicProcedure", value: "publicProcedure" },
        { name: "Custom (type manually)", value: "custom" },
      ],
    },
  ]);

  if (procedure !== "custom") {
    return procedure;
  }

  const { customProcedure } = await inquirer.prompt<{
    customProcedure: string;
  }>([
    {
      type: "input",
      name: "customProcedure",
      message: "Enter the custom procedure name",
      validate: (value: string) =>
        value.trim().length ? true : "Procedure name is required.",
    },
  ]);

  return customProcedure.trim();
}

async function confirmAction(message: string, defaultValue: boolean) {
  if (!(process.stdin.isTTY && process.stdout.isTTY)) {
    return defaultValue;
  }

  const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
    {
      type: "confirm",
      name: "confirm",
      message,
      default: defaultValue,
    },
  ]);
  return confirm;
}

async function exitWithMessage(message: string) {
  console.log(message);
  process.exitCode = 1;
}

async function readPackageJsonSafe(): Promise<Record<string, unknown>> {
  try {
    const content = await fs.readFile(packageJsonPath, "utf8");
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function detectServerOnlyImport(packageInfo: Record<string, unknown>) {
  const dependencies = {
    ...(packageInfo.dependencies as Record<string, string>),
    ...(packageInfo.devDependencies as Record<string, string>),
  };

  if (dependencies?.["server-cli-only"]) {
    return "server-cli-only";
  }

  if (dependencies?.["server-only"]) {
    return "server-only";
  }

  return "server-cli-only";
}

async function detectLoggerImportPath() {
  const utilsLogger = path.resolve(workspaceRoot, "src", "utils", "logger.ts");
  const utilsLoggerTsx = path.resolve(
    workspaceRoot,
    "src",
    "utils",
    "logger.tsx",
  );
  const libLogger = path.resolve(workspaceRoot, "src", "lib", "logger.ts");

  if ((await pathExists(utilsLogger)) || (await pathExists(utilsLoggerTsx))) {
    return "@/utils/logger";
  }

  if (await pathExists(libLogger)) {
    return "@/lib/logger";
  }

  return "@/utils/logger";
}

async function procedureIsExported(procedure: string) {
  const canonicalTrpcFile = path.resolve(
    workspaceRoot,
    "src",
    "server",
    "features",
    "trpc.ts",
  );
  const legacyTrpcFile = path.resolve(
    workspaceRoot,
    "src",
    "services",
    "trpc.ts",
  );

  const trpcFile = (await pathExists(canonicalTrpcFile))
    ? canonicalTrpcFile
    : legacyTrpcFile;

  if (!(await pathExists(trpcFile))) {
    return false;
  }

  const content = await fs.readFile(trpcFile, "utf8");
  return content.includes(`export const ${procedure}`);
}

async function getServiceDirectories() {
  if (!(await pathExists(servicesRoot))) {
    return [] as string[];
  }

  const entries = await fs.readdir(servicesRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(servicesRoot, entry.name));
}

function collectServiceRootIssues(issues: LintIssue[]) {
  if (servicesRoot === legacyServicesRoot) {
    issues.push({
      level: "warning",
      rule: "structure.root.legacy",
      message:
        "Using legacy service root src/services; canonical root is src/server/features.",
      suggestion:
        "Migrate services to src/server/features to align with service-guide.md and unlock canonical structure checks.",
      file: legacyServicesRoot,
    });
  }
}

async function getModuleDirectories(serviceDir: string) {
  const entries = await fs.readdir(serviceDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .filter((entry) => entry.name !== "adapters")
    .map((entry) => path.join(serviceDir, entry.name));
}

function normalizeKebab(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeAndDedupeKebabNames(values: string[]) {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const value of values) {
    const name = normalizeKebab(value);
    if (!name || seen.has(name)) {
      continue;
    }
    seen.add(name);
    normalized.push(name);
  }

  return normalized;
}

function toPascalCase(value: string) {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((segment) => segment[0]?.toUpperCase() + segment.slice(1))
    .join("");
}

function toCamelCase(value: string) {
  const pascal = toPascalCase(value);
  return pascal ? (pascal[0] ?? "").toLowerCase() + pascal.slice(1) : "";
}

function buildRelativeImportPath(
  depth: number,
  fileNameWithoutExtension: string,
) {
  const safeDepth = Math.max(1, depth);
  return `${"../".repeat(safeDepth)}${fileNameWithoutExtension}`;
}

function getFirstImportLine(content: string) {
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//")) {
      continue;
    }
    if (trimmed.startsWith("import ")) {
      return trimmed;
    }
    return null;
  }
  return null;
}

function getConstructorParts(content: string) {
  const constructorIndex = content.indexOf("constructor(");
  if (constructorIndex === -1) {
    return null;
  }

  const openParenIndex = content.indexOf("(", constructorIndex);
  if (openParenIndex === -1) {
    return null;
  }

  const closeParenIndex = findMatchingToken(content, openParenIndex, "(", ")");
  if (closeParenIndex === -1) {
    return null;
  }

  const openBraceIndex = content.indexOf("{", closeParenIndex);
  if (openBraceIndex === -1) {
    return null;
  }

  const closeBraceIndex = findMatchingToken(content, openBraceIndex, "{", "}");
  if (closeBraceIndex === -1) {
    return null;
  }

  return {
    params: content.slice(openParenIndex + 1, closeParenIndex),
    body: content.slice(openBraceIndex + 1, closeBraceIndex),
  };
}

function findMatchingToken(
  content: string,
  startIndex: number,
  openToken: string,
  closeToken: string,
) {
  let depth = 0;

  for (let index = startIndex; index < content.length; index += 1) {
    const char = content[index];
    if (char === openToken) {
      depth += 1;
    } else if (char === closeToken) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

async function pathExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function detectMisplacedModuleFiles(
  serviceDir: string,
  serviceName: string,
) {
  const entries = await fs.readdir(serviceDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
  const moduleFilePattern =
    /^(?<base>[a-z0-9-]+)\.(types|input|schema|router|repository|service)\.ts$/i;

  return files
    .filter((fileName) => moduleFilePattern.test(fileName))
    .filter((fileName) => {
      const base = fileName.split(".")[0] ?? "";
      return base.length > 0 && base !== serviceName;
    })
    .map((fileName) => path.join(serviceDir, fileName));
}

async function detectUnexpectedServiceFiles(
  serviceDir: string,
  baseName: string,
) {
  const entries = await fs.readdir(serviceDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);

  const allowed = new Set<string>([
    `${baseName}.types.ts`,
    `${baseName}.input.ts`,
    `${baseName}.schema.ts`,
    `${baseName}.router.ts`,
    `${baseName}.repository.ts`,
    `${baseName}.service.ts`,
    `${baseName}.config.ts`,
  ]);

  return files
    .filter((fileName) => fileName.endsWith(".ts"))
    .filter((fileName) => !fileName.endsWith(".d.ts"))
    .filter((fileName) => !allowed.has(fileName))
    .map((fileName) => path.join(serviceDir, fileName));
}

async function collectAdapterStructureIssues(params: {
  baseDir: string;
  issues: LintIssue[];
}) {
  const localAdapterFiles = await fg(["**/*.adapter.ts"], {
    cwd: params.baseDir,
    absolute: true,
  });

  for (const adapterFile of localAdapterFiles) {
    params.issues.push({
      level: "warning",
      rule: "adapter.location",
      message:
        "Feature/module-local adapter detected. Adapters should live under src/server/adapters.",
      suggestion:
        "Move this adapter file into src/server/adapters and inject it into services via constructor dependencies.",
      file: adapterFile,
    });
  }
}

async function collectGlobalAdapterStructureIssues(issues: LintIssue[]) {
  if (!(await pathExists(adaptersRoot))) {
    issues.push({
      level: "warning",
      rule: "adapter.location",
      message: "Missing src/server/adapters folder.",
      suggestion:
        "Create src/server/adapters and place external integration adapters there.",
      file: adaptersRoot,
    });
    return;
  }

  const adapterFiles = await fg(["**/*.adapter.ts"], {
    cwd: adaptersRoot,
    absolute: true,
  });

  if (adapterFiles.length === 0) {
    issues.push({
      level: "warning",
      rule: "adapter.folder.file",
      message: "No adapter files were found under src/server/adapters.",
      suggestion:
        "Add adapter files with the .adapter.ts suffix under src/server/adapters.",
      file: adaptersRoot,
    });
  }
}

function getImportedAdapterNames(content: string) {
  const adapterNames = new Set<string>();

  const importRegex =
    /import\s+(?:type\s+)?(?:\{([^}]+)\}|([A-Za-z0-9_]+))\s+from\s+["']@\/server\/adapters\/[^"']+["']/g;

  for (const match of content.matchAll(importRegex)) {
    const namedImports = match[1];
    const defaultImport = match[2];

    if (defaultImport) {
      adapterNames.add(defaultImport.trim());
    }

    if (namedImports) {
      namedImports
        .split(",")
        .map((value) => value.trim())
        .map((value) => value.replace(/^type\s+/, ""))
        .map((value) => value.split(/\s+as\s+/i).pop() ?? value)
        .filter((value) => value.length > 0)
        .forEach((value) => adapterNames.add(value));
    }
  }

  return Array.from(adapterNames).filter((name) => name.endsWith("Adapter"));
}

function hasRepositoryDbImport(content: string) {
  return /import\s+\{[^}]*\bdb\b[^}]*\}\s+from\s+["']@\/server\/database["']/.test(
    content,
  );
}

function hasDbConstructorInjection(constructorParams: string) {
  return /\b(?:private|public|protected)\s+(?:readonly\s+)?\w+\s*:\s*typeof\s+db\s*=\s*db\b/.test(
    constructorParams,
  );
}

function hasLoggerConstructorInjection(constructorParams: string) {
  return /\b(?:private|public|protected)\s+(?:readonly\s+)?\w+\s*:\s*Logger\s*=\s*new\s+Logger\s*\(/.test(
    constructorParams,
  );
}

function getExportedZodValidatorNames(content: string) {
  const zodConstNames = new Set<string>();
  const exportedNames = new Set<string>();

  const zodConstRegex = /(const|let|var)\s+(\w+)\s*=\s*z\./g;
  for (const match of content.matchAll(zodConstRegex)) {
    if (match[2]) {
      zodConstNames.add(match[2]);
    }
  }

  const exportConstRegex = /export\s+const\s+(\w+)\s*=\s*z\./g;
  for (const match of content.matchAll(exportConstRegex)) {
    if (match[1]) {
      exportedNames.add(match[1]);
    }
  }

  const exportNamedRegex = /export\s*\{([^}]+)\}/g;
  for (const match of content.matchAll(exportNamedRegex)) {
    const exports = match[1] ?? "";
    exports
      .split(",")
      .map((value) => value.trim().split(/\s+as\s+/i)[0])
      .filter((name): name is string => Boolean(name))
      .forEach((name) => exportedNames.add(name));
  }

  return Array.from(exportedNames).filter((name) => zodConstNames.has(name));
}

async function runContext(options: {
  service?: string;
  includeLint?: boolean;
  format?: OutputFormat;
}) {
  const format = normalizeOutputFormat(options.format);
  const serviceDirs = await getServiceDirectories();
  const filteredDirs = options.service
    ? serviceDirs.filter(
        (serviceDir) =>
          path.basename(serviceDir) === normalizeKebab(options.service ?? ""),
      )
    : serviceDirs;

  const services = await Promise.all(
    filteredDirs.map(async (serviceDir) => {
      const serviceName = path.basename(serviceDir);
      const files = await fg(["**/*.ts"], {
        cwd: serviceDir,
        onlyFiles: true,
      });

      return {
        name: serviceName,
        path: path.relative(workspaceRoot, serviceDir),
        files,
      };
    }),
  );

  const payload: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    services,
  };

  if (options.includeLint) {
    payload.lint = await collectLintIssues();
  }

  if (format === "json") {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(chalk.cyan(`Services: ${services.length}`));
  for (const service of services) {
    console.log(`- ${service.name} (${service.files.length} files)`);
  }
}

async function runExplainRule(
  ruleId: string,
  options: { format?: OutputFormat },
) {
  const format = normalizeOutputFormat(options.format);
  const rule = LINT_RULES[ruleId];

  if (!rule) {
    const message = `Unknown rule: ${ruleId}`;
    if (format === "json") {
      console.log(
        JSON.stringify(
          {
            success: false,
            message,
            availableRules: Object.keys(LINT_RULES).sort(),
          },
          null,
          2,
        ),
      );
      return;
    }

    console.log(chalk.red(message));
    return;
  }

  if (format === "json") {
    console.log(
      JSON.stringify(
        {
          success: true,
          rule,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(`${rule.id} (${rule.level})`);
  console.log(`Autofixable: ${rule.autofixable ? "yes" : "no"}`);
  console.log(`Guide section: ${rule.guideSection}`);
  console.log(rule.description);
}

async function runListRules(options: { format?: OutputFormat }) {
  const format = normalizeOutputFormat(options.format);

  const rules = Object.values(LINT_RULES)
    .slice()
    .sort((left, right) => left.id.localeCompare(right.id));

  if (format === "json") {
    console.log(
      JSON.stringify(
        {
          count: rules.length,
          rules,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(chalk.cyan(`Registered lint rules: ${rules.length}`));
  for (const rule of rules) {
    const autofixable = rule.autofixable ? "autofixable" : "manual";
    console.log(
      `- ${rule.id} (${rule.level}, ${autofixable}, ${rule.guideSection})`,
    );
  }
}

async function collectLintIssues() {
  const packageInfo = await readPackageJsonSafe();
  const detectedServerOnlyImport = detectServerOnlyImport(packageInfo);
  const loggerImportPath = await detectLoggerImportPath();
  const issues: LintIssue[] = [];

  await runLintInternal({
    issues,
    detectedServerOnlyImport,
    loggerImportPath,
  });

  return issues;
}

function normalizeOutputFormat(format?: string): OutputFormat {
  return format === "json" ? "json" : "text";
}

function emitOperationResult(result: OperationResult, format: OutputFormat) {
  if (format !== "json") {
    return;
  }

  console.log(JSON.stringify(result, null, 2));
}

async function runLintInternal(params: {
  issues: LintIssue[];
  detectedServerOnlyImport: string;
  loggerImportPath: string;
}) {
  const { issues, detectedServerOnlyImport } = params;
  void params.loggerImportPath;

  collectServiceRootIssues(issues);

  const serviceDirs = await getServiceDirectories();

  for (const serviceDir of serviceDirs) {
    const serviceName = path.basename(serviceDir);
    const serviceFile = path.join(serviceDir, `${serviceName}.service.ts`);
    const repositoryFile = path.join(
      serviceDir,
      `${serviceName}.repository.ts`,
    );
    const routerFile = path.join(serviceDir, `${serviceName}.router.ts`);
    const typesFile = path.join(serviceDir, `${serviceName}.types.ts`);
    const inputFile = path.join(serviceDir, `${serviceName}.input.ts`);
    const schemaFile = path.join(serviceDir, `${serviceName}.schema.ts`);

    const serviceExists = await pathExists(serviceFile);
    const repositoryExists = await pathExists(repositoryFile);
    const routerExists = await pathExists(routerFile);
    const typesExists = await pathExists(typesFile);
    const inputExists = await pathExists(inputFile);
    const schemaExists = await pathExists(schemaFile);

    if (!typesExists) {
      issues.push({
        level: "warning",
        rule: "structure.types-file",
        message: "Missing types file for this feature.",
        suggestion:
          "Add a <service>.types.ts file for shared domain types used across layers.",
        file: typesFile,
      });
    }

    if (!serviceExists) {
      issues.push({
        level: "error",
        rule: "structure.service-file",
        message: "Missing service file for this feature.",
        suggestion: "Add the service file so the feature exposes a public API.",
        file: serviceFile,
      });
    }

    if (routerExists && !inputExists) {
      issues.push({
        level: "error",
        rule: "router.input.required",
        message: "Router exists but no input file was found.",
        suggestion:
          "Create an input file and add validators used by the router.",
        file: inputFile,
      });
    }

    if (routerExists && !serviceExists) {
      issues.push({
        level: "error",
        rule: "router.service.required",
        message: "Router exists but no service file was found.",
        suggestion: "Create a service file and ensure the router calls it.",
        file: serviceFile,
      });
    }

    if (repositoryExists && !schemaExists) {
      issues.push({
        level: "warning",
        rule: "repository.schema.recommended",
        message: "Repository exists but schema file is missing.",
        suggestion: "Add a schema file if the repository touches the database.",
        file: schemaFile,
      });
    }

    await collectAdapterStructureIssues({
      baseDir: serviceDir,
      issues,
    });
  }

  const serviceAndRepositoryFiles = await fg(
    ["**/*.service.ts", "**/*.repository.ts"],
    {
      cwd: servicesRoot,
      absolute: true,
    },
  );

  for (const file of serviceAndRepositoryFiles) {
    const content = await fs.readFile(file, "utf8");
    const firstImport = getFirstImportLine(content);
    if (!firstImport?.includes(detectedServerOnlyImport)) {
      issues.push({
        level: "error",
        rule: "server-cli-only.first-line",
        message: `First import should be import \"${detectedServerOnlyImport}\";`,
        suggestion:
          "Move the server-cli-only import to the first line of the file.",
        file,
      });
    }

    if (file.endsWith(".service.ts")) {
      const constructorInfo = getConstructorParts(content);
      const importedAdapters = getImportedAdapterNames(content);

      if (constructorInfo) {
        const constructorParams = constructorInfo.params.trim();
        const hasParamsObject = /\bparams\s*(?:\?|:|=|,|\))/m.test(
          constructorParams,
        );
        const hasDependencyParameter =
          /\b(?:private|public|protected)\s+(?:readonly\s+)?\w+\s*:\s*[A-Za-z0-9_]+(?:Service|Repository|Adapter)\b/.test(
            constructorParams,
          );
        const hasDependencyImports =
          /import\s+[^;]*(?:Service|Repository|Adapter)\b[^;]*from\s+["'][^"']+["']/.test(
            content,
          );
        const hasDirectDependencyNew =
          /this\.\w+\s*=\s*new\s+[A-Za-z0-9_]+(?:Service|Repository|Adapter)\s*\(/.test(
            constructorInfo.body,
          );

        if (
          (hasParamsObject || !hasDependencyParameter) &&
          hasDependencyImports
        ) {
          issues.push({
            level: "warning",
            rule: "di.constructor.params",
            message:
              "Service constructor should inject dependencies directly via constructor parameters.",
            suggestion:
              "Use constructor(private readonly repository: Repo = new Repo(), public module: ModuleService = new ModuleService()) {}.",
            file,
          });
        }

        if (hasDirectDependencyNew) {
          issues.push({
            level: "warning",
            rule: "di.constructor.inline-new",
            message:
              "Constructor body creates dependencies directly instead of using constructor parameter defaults.",
            suggestion:
              "Move dependency defaults to constructor parameters, e.g. private readonly repository: Repo = new Repo().",
            file,
          });
        }

        if (importedAdapters.length > 0) {
          const missingAdapterConstructorInjection = importedAdapters.filter(
            (adapterName) =>
              !new RegExp(`:\\s*${adapterName}\\b`).test(constructorParams),
          );

          if (missingAdapterConstructorInjection.length > 0) {
            issues.push({
              level: "warning",
              rule: "di.adapter.constructor",
              message:
                "Service imports adapters but does not inject them via constructor dependency parameters.",
              suggestion: `Inject adapters in constructor parameters: ${missingAdapterConstructorInjection.join(
                ", ",
              )}.`,
              file,
            });
          }
        }
      } else if (importedAdapters.length > 0) {
        issues.push({
          level: "warning",
          rule: "di.adapter.constructor",
          message:
            "Service imports adapters but has no constructor for dependency injection.",
          suggestion:
            "Add a constructor and inject adapters as dependency parameters.",
          file,
        });
      }
    }

    const constructorInfo = getConstructorParts(content);
    const hasLoggerFieldNew =
      /private\s+readonly\s+logger\s*=\s*new\s+Logger\s*\(/.test(content);

    if (constructorInfo) {
      const constructorParams = constructorInfo.params.trim();

      if (
        content.includes("import Logger") &&
        !hasLoggerConstructorInjection(constructorParams)
      ) {
        issues.push({
          level: "warning",
          rule: "di.logger.constructor",
          message:
            "Logger should be injected via constructor dependency parameters.",
          suggestion:
            'Use constructor(private readonly logger: Logger = new Logger("Context"), ...) {}.',
          file,
        });
      }

      if (hasLoggerFieldNew) {
        issues.push({
          level: "warning",
          rule: "di.logger.field-new",
          message:
            "Logger is initialized directly in a class field instead of constructor injection.",
          suggestion:
            "Move logger initialization into constructor dependency parameters.",
          file,
        });
      }

      if (
        file.endsWith(".repository.ts") &&
        hasRepositoryDbImport(content) &&
        !hasDbConstructorInjection(constructorParams)
      ) {
        issues.push({
          level: "warning",
          rule: "di.repository.db",
          message:
            "Repository imports db but does not inject it through constructor dependency parameters.",
          suggestion:
            "Use constructor(private readonly database: typeof db = db, ...) {} and reference this.database in queries.",
          file,
        });
      }
    } else {
      if (content.includes("import Logger")) {
        issues.push({
          level: "warning",
          rule: "di.logger.constructor",
          message:
            "Class uses Logger but has no constructor dependency injection for logger.",
          suggestion: "Add a constructor and inject logger dependency there.",
          file,
        });
      }

      if (file.endsWith(".repository.ts") && hasRepositoryDbImport(content)) {
        issues.push({
          level: "warning",
          rule: "di.repository.db",
          message:
            "Repository imports db but has no constructor dependency injection for db.",
          suggestion:
            "Add a constructor and inject db dependency as a parameter default.",
          file,
        });
      }
    }
  }

  await collectGlobalAdapterStructureIssues(issues);
}

function formatLintOutput(issues: LintIssue[], format: "text" | "json") {
  if (format === "json") {
    return JSON.stringify({ issues }, null, 2);
  }

  if (issues.length === 0) {
    return "";
  }

  return issues
    .map((issue) => {
      const prefix =
        issue.level === "error" ? chalk.red("error") : chalk.yellow("warning");
      const location = issue.file
        ? ` (${path.relative(workspaceRoot, issue.file)})`
        : "";
      const suggestion = issue.suggestion ? ` Fix: ${issue.suggestion}` : "";
      return `${prefix} [${issue.rule}]${location}: ${issue.message}${suggestion}`;
    })
    .join("\n");
}
