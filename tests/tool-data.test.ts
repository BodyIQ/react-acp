import assert from "node:assert/strict";
import { test } from "vitest";
import type { SessionNotification } from "@agentclientprotocol/sdk";
import { acpToolData, terminalToolDisplay } from "../src/core/tool-data";

const notification = (meta: Record<string, unknown>): SessionNotification => ({
  sessionId: "history",
  update: { sessionUpdate: "tool_call_update", toolCallId: "exec", _meta: meta },
});

test("terminal references render output accumulated by the ACP runtime", () => {
  const artifact = {
    acp: {
      title: "Read source",
      content: [{ type: "terminal", terminalId: "exec" }],
      display: { output: "hello\nworld\n", cwd: "/repo", exitCode: 0 },
    },
  };
  const view = acpToolData(artifact, { command: "cat source.ts" }, [
    { type: "terminal", terminalId: "exec" },
  ]);
  assert.equal(view.output, "hello\nworld\n");
  assert.equal(view.cwd, "/repo");
  assert.equal(view.command, "cat source.ts");
  assert.equal(view.exitCode, 0);
});

test("replayed output is displayed once when the final content also contains it", () => {
  const view = acpToolData(
    {
      acp: {
        content: [{ type: "content", content: { type: "text", text: "failure\n" } }],
        display: { output: "failure\n", exitCode: 2 },
      },
    },
    { command: ["rg", "pattern", "src"] },
    undefined,
  );
  assert.equal(view.output, "failure\n");
  assert.equal(view.exitCode, 2);
  assert.equal(view.command, "rg pattern src");
});

test("file reads, searches and MCP results expose readable text", () => {
  const view = acpToolData(
    {
      acp: {
        locations: [{ path: "src/index.ts" }],
        content: [{ type: "content", content: { type: "text", text: "matching line" } }],
      },
    },
    { file_path: "src/index.ts", pattern: "match" },
    { exit_code: 0 },
  );
  assert.equal(view.output, "matching line");
  assert.equal(view.query, "match");
  assert.equal(view.path, "src/index.ts");
  assert.deepEqual(view.locations, ["src/index.ts"]);
  assert.equal(
    acpToolData(undefined, {}, { content: [{ type: "text", text: "MCP answer" }] }).output,
    "MCP answer",
  );
  assert.equal(
    acpToolData(undefined, {}, { stdout: "out\n", stderr: "err\n" }).output,
    "out\nerr\n",
  );
});

test("edits retain complete before and after text, including new and empty files", () => {
  const diffs = [
    { type: "diff", path: "existing.ts", oldText: "old", newText: "new" },
    { type: "diff", path: "new.ts", oldText: null, newText: "created" },
    { type: "diff", path: "empty.ts", oldText: "removed", newText: "" },
  ];
  const view = acpToolData({ acp: { content: diffs } }, {}, undefined);
  assert.deepEqual(
    view.diffs,
    diffs.map(({ path, oldText, newText }) => ({ path, oldText, newText })),
  );
});

test("Agent terminal output metadata is decoded once per notification", () => {
  assert.deepEqual(terminalToolDisplay(notification({ terminal_info: { cwd: "/repo" } })), {
    outputDelta: undefined,
    cwd: "/repo",
    exitCode: undefined,
  });
  assert.deepEqual(
    terminalToolDisplay(
      notification({ terminal_output_delta: { data: "hello" }, terminal_exit: { exit_code: 0 } }),
    ),
    {
      outputDelta: "hello",
      cwd: undefined,
      exitCode: 0,
    },
  );
  assert.deepEqual(terminalToolDisplay(notification({ mcp_output_delta: { data: "progress" } })), {
    outputDelta: "progress",
    cwd: undefined,
    exitCode: undefined,
  });
  assert.equal(terminalToolDisplay(notification({})), undefined);
});

test("partial and unknown artifacts cannot turn protocol objects into output", () => {
  assert.equal(acpToolData(null, null, [{ type: "terminal", terminalId: "id" }]).output, "");
  assert.equal(acpToolData({ acp: { display: {} } }, {}, undefined).output, "");
  assert.equal(acpToolData({}, {}, "plain output").output, "plain output");
});
