#!/usr/bin/env bun

import { spawn } from "node:child_process";
import path from "node:path";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolRequest,
} from "@modelcontextprotocol/sdk/types.js";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type CliResult = {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  json?: JsonValue;
};

const cliPath = path.resolve(process.cwd(), "scripts", "service.ts");
const bunPath = process.env.BUN_PATH ?? "bun";

async function runCli(args: string[]): Promise<CliResult> {
  const finalArgs = [cliPath, ...args];

  return await new Promise<CliResult>((resolve) => {
    const child = spawn(bunPath, finalArgs, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      const trimmed = stdout.trim();
      let parsed: JsonValue | undefined;

      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try {
          parsed = JSON.parse(trimmed) as JsonValue;
        } catch {
          parsed = undefined;
        }
      }

      resolve({
        ok: (code ?? 1) === 0,
        exitCode: code ?? 1,
        stdout,
        stderr,
        json: parsed,
      });
    });

    child.on("error", (error) => {
      resolve({
        ok: false,
        exitCode: 1,
        stdout,
        stderr: `${stderr}\n${String(error)}`.trim(),
      });
    });
  });
}

function getString(input: unknown, key: string): string | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function getBoolean(input: unknown, key: string): boolean | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "boolean" ? value : undefined;
}

function pushFlag(args: string[], flag: string, value?: string | boolean) {
  if (typeof value === "boolean") {
    if (value) {
      args.push(flag);
    }
    return;
  }
  if (typeof value === "string" && value.length > 0) {
    args.push(flag, value);
  }
}

async function handleToolCall(request: CallToolRequest) {
  const name = request.params.name;
  const input = request.params.arguments;

  let args: string[] = [];

  if (name === "service_create") {
    args = ["create", "--format", "json"];
    pushFlag(args, "--name", getString(input, "name"));
    pushFlag(args, "--modules", getString(input, "modules"));
    pushFlag(args, "--procedure", getString(input, "procedure"));
    pushFlag(args, "--force", getBoolean(input, "force"));
    pushFlag(args, "--dry-run", getBoolean(input, "dryRun"));
    pushFlag(args, "--skip-router", getBoolean(input, "skipRouter"));
    pushFlag(args, "--skip-input", getBoolean(input, "skipInput"));
    pushFlag(args, "--skip-schema", getBoolean(input, "skipSchema"));
    pushFlag(args, "--skip-repository", getBoolean(input, "skipRepository"));
    pushFlag(args, "--skip-service", getBoolean(input, "skipService"));
  } else if (name === "service_add_module") {
    args = ["add-module", "--format", "json"];
    pushFlag(args, "--service", getString(input, "service"));
    pushFlag(args, "--module", getString(input, "module"));
    pushFlag(args, "--force", getBoolean(input, "force"));
    pushFlag(args, "--dry-run", getBoolean(input, "dryRun"));
  } else if (name === "service_add_submodule") {
    args = ["add-submodule", "--format", "json"];
    pushFlag(args, "--service", getString(input, "service"));
    pushFlag(args, "--module", getString(input, "module"));
    pushFlag(args, "--submodule", getString(input, "submodule"));
    pushFlag(args, "--force", getBoolean(input, "force"));
    pushFlag(args, "--dry-run", getBoolean(input, "dryRun"));
  } else if (name === "service_lint") {
    args = ["lint", "--format", "json"];
    pushFlag(args, "--strict", getBoolean(input, "strict"));
  } else if (name === "service_context") {
    args = ["context", "--format", "json"];
    pushFlag(args, "--service", getString(input, "service"));
    pushFlag(args, "--include-lint", getBoolean(input, "includeLint"));
  } else if (name === "service_explain_rule") {
    const rule = getString(input, "rule");
    if (!rule) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ok: false,
                error: "Missing required argument: rule",
              },
              null,
              2,
            ),
          },
        ],
        isError: true,
      };
    }

    args = ["explain-rule", rule, "--format", "json"];
  } else {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ ok: false, error: `Unknown tool: ${name}` }),
        },
      ],
      isError: true,
    };
  }

  const result = await runCli(args);
  const payload = {
    ok: result.ok,
    exitCode: result.exitCode,
    data: result.json ?? null,
    stdout: result.stdout,
    stderr: result.stderr,
    command: [bunPath, ...args].join(" "),
  };

  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    isError: !result.ok,
  };
}

const server = new Server(
  {
    name: "service-cli-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "service_create",
        description:
          "Create a new service with optional modules using scripts/service.ts create, including <name>.types.ts files.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string" },
            modules: {
              type: "string",
              description: "Comma-separated module names",
            },
            procedure: { type: "string" },
            force: { type: "boolean" },
            dryRun: { type: "boolean" },
            skipRouter: { type: "boolean" },
            skipInput: { type: "boolean" },
            skipSchema: { type: "boolean" },
            skipRepository: { type: "boolean" },
            skipService: { type: "boolean" },
          },
          additionalProperties: false,
        },
      },
      {
        name: "service_add_module",
        description:
          "Add a module to an existing service, including a <module>.types.ts file.",
        inputSchema: {
          type: "object",
          properties: {
            service: { type: "string" },
            module: { type: "string" },
            force: { type: "boolean" },
            dryRun: { type: "boolean" },
          },
          required: ["service", "module"],
          additionalProperties: false,
        },
      },
      {
        name: "service_add_submodule",
        description:
          "Add a submodule under an existing module, including a <submodule>.types.ts file.",
        inputSchema: {
          type: "object",
          properties: {
            service: { type: "string" },
            module: { type: "string" },
            submodule: { type: "string" },
            force: { type: "boolean" },
            dryRun: { type: "boolean" },
          },
          required: ["service", "module", "submodule"],
          additionalProperties: false,
        },
      },
      {
        name: "service_lint",
        description: "Run service lint and return JSON issues.",
        inputSchema: {
          type: "object",
          properties: {
            strict: { type: "boolean" },
          },
          additionalProperties: false,
        },
      },
      {
        name: "service_context",
        description:
          "Get service tree and optionally lint issues for AI planning workflows.",
        inputSchema: {
          type: "object",
          properties: {
            service: { type: "string" },
            includeLint: { type: "boolean" },
          },
          additionalProperties: false,
        },
      },
      {
        name: "service_explain_rule",
        description: "Explain one lint rule and its guide mapping.",
        inputSchema: {
          type: "object",
          properties: {
            rule: { type: "string" },
          },
          required: ["rule"],
          additionalProperties: false,
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, handleToolCall);

const transport = new StdioServerTransport();
await server.connect(transport);
