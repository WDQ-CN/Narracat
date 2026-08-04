import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import {
  auditForeshadowingLifecycle,
  formatForeshadowingLifecycleAuditReport,
} from "../agent-core/narracat/mcp-server/dist/foreshadowing-audit.js";

type OpenedDatabase = Parameters<typeof auditForeshadowingLifecycle>[0] & {
  close(): void;
};
type DatabaseConstructor = new (
  filename: string,
  options?: { readonly?: boolean; fileMustExist?: boolean },
) => OpenedDatabase;

interface CliOptions {
  projectRoot: string | null;
  ids: string[];
  json: boolean;
  failOnFindings: boolean;
}

const requireFromMcpServer = createRequire(
  new URL("../agent-core/narracat/mcp-server/package.json", import.meta.url),
);
const Database = requireFromMcpServer("better-sqlite3") as DatabaseConstructor;

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options.projectRoot) {
    process.stderr.write(
      "Usage: bun --no-cache run audit:foreshadowing -- <novel-project-root> [--id F-CELLAR] [--json] [--fail-on-findings]\n",
    );
    process.exitCode = 1;
    return;
  }

  const projectRoot = resolve(options.projectRoot);
  const configPath = join(projectRoot, ".narracat", "config.yaml");
  const dbPath = join(projectRoot, ".narracat", "memory.db");
  if (!existsSync(configPath)) {
    throw new Error(`Missing config: ${configPath}`);
  }
  if (!existsSync(dbPath)) {
    throw new Error(`Missing NovelMemory database: ${dbPath}`);
  }

  const novelId = readNovelId(configPath);
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const report = auditForeshadowingLifecycle(db, novelId, {
      foreshadowingIds: options.ids,
    });
    process.stdout.write(
      options.json
        ? `${JSON.stringify(report, null, 2)}\n`
        : formatForeshadowingLifecycleAuditReport(report),
    );
    if (options.failOnFindings && report.findings.length > 0) {
      process.exitCode = 2;
    }
  } finally {
    db.close();
  }
}

function parseArgs(args: string[]): CliOptions {
  const ids: string[] = [];
  let projectRoot: string | null = null;
  let json = false;
  let failOnFindings = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--fail-on-findings") {
      failOnFindings = true;
      continue;
    }
    if (arg === "--id") {
      const value = args[index + 1];
      if (!value) throw new Error("--id requires a foreshadowing id");
      ids.push(value);
      index += 1;
      continue;
    }
    if (arg?.startsWith("--id=")) {
      ids.push(arg.slice("--id=".length));
      continue;
    }
    if (!projectRoot) {
      projectRoot = arg ?? null;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { projectRoot, ids, json, failOnFindings };
}

function readNovelId(configPath: string): string {
  const content = readFileSync(configPath, "utf-8");
  const match = content.match(/^novel_id:\s*["']?([^\s"'#]+)["']?/m);
  if (!match?.[1]) throw new Error(`Missing novel_id in ${configPath}`);
  return match[1];
}

await main();
