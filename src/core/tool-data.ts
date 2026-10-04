import type { AcpRuntimeExtensionAdapter } from "./types";

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function command(value: unknown): string | undefined {
  return Array.isArray(value) && value.every((part) => typeof part === "string")
    ? value.join(" ")
    : text(value);
}

/** A file edit decoded from ACP tool content. */
export type ToolDiff = { path: string; oldText: string | null; newText: string };

/** Decode terminal-output metadata used by ACP agents including Codex and Claude.
 * This extension is separate from the standard client-owned terminal service. */
export const terminalToolDisplay: NonNullable<AcpRuntimeExtensionAdapter["toolDisplay"]> = (
  notification,
) => {
  const meta = record(notification.update._meta);
  const outputDelta =
    ["terminal_output_delta", "terminal_output", "mcp_output_delta"]
      .map((key) => text(record(meta[key]).data))
      .filter((chunk) => chunk !== undefined)
      .join("") || undefined;
  const cwd = text(record(meta.terminal_info).cwd);
  const code = record(meta.terminal_exit).exit_code;
  const exitCode = typeof code === "number" ? code : undefined;
  return outputDelta || cwd || exitCode !== undefined ? { outputDelta, cwd, exitCode } : undefined;
};

function readableContent(value: unknown): { texts: string[]; diffs: ToolDiff[] } {
  const texts: string[] = [];
  const diffs: ToolDiff[] = [];
  for (const item of Array.isArray(value) ? value : []) {
    const part = record(item);
    if (part.type === "diff" && typeof part.path === "string" && typeof part.newText === "string") {
      diffs.push({ path: part.path, oldText: text(part.oldText) ?? null, newText: part.newText });
    } else {
      const content = part.type === "content" ? record(part.content) : part;
      if (content.type === "text" && typeof content.text === "string") texts.push(content.text);
    }
  }
  return { texts, diffs };
}

/** Decode the ACP artifact that react-acp preserves on an assistant-ui part. */
export function acpToolData(
  artifact: unknown,
  argsValue: unknown,
  result: unknown,
): {
  title: string | undefined;
  command: string | undefined;
  path: string | undefined;
  query: string | undefined;
  cwd: string | undefined;
  exitCode: number | undefined;
  locations: string[];
  output: string;
  diffs: ToolDiff[];
} {
  const acp = record(record(artifact).acp);
  const args = record(argsValue);
  const display = record(acp.display);
  const content = readableContent(acp.content);
  const fallbackContent = readableContent(record(result).content ?? result);
  const exitCode = typeof display.exitCode === "number" ? display.exitCode : undefined;
  const cwd = text(args.cwd) ?? text(display.cwd);
  const rawResult = record(result);
  const streams = [text(rawResult.stdout), text(rawResult.stderr)].filter(
    (stream) => stream !== undefined,
  );
  const resultText =
    text(result) ?? (streams.length > 0 ? streams.join("") : text(rawResult.output));
  return {
    title: text(acp.title),
    command: command(args.command) ?? command(args.cmd),
    path: text(args.path) ?? text(args.file_path) ?? text(args.filePath),
    query: text(args.query) ?? text(args.pattern),
    cwd,
    exitCode:
      exitCode ?? (typeof rawResult.exit_code === "number" ? rawResult.exit_code : undefined),
    locations: (Array.isArray(acp.locations) ? acp.locations : []).flatMap((location) => {
      const path = text(record(location).path);
      return path === undefined ? [] : [path];
    }),
    output:
      text(display.output) ||
      resultText ||
      (content.texts.length > 0
        ? content.texts.join("\n")
        : (resultText ?? fallbackContent.texts.join("\n"))),
    diffs: content.diffs.length > 0 ? content.diffs : fallbackContent.diffs,
  };
}
