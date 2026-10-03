import type { SessionNotification } from "@agentclientprotocol/sdk";
import { expect, it, vi } from "vitest";
import { AcpThreadController } from "../src/core/controller";
import { projectAcpThreadMessages } from "../src/core/projection";
import type { AcpClientConnection } from "../src/core/types";
import { ConformanceAdapter } from "./fixture";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

it("publishes session/load history once, then streams live updates", async () => {
  const adapter = new ConformanceAdapter();
  const replaySent = deferred();
  const finishLoad = deferred();
  adapter.connection.loadSession = vi.fn<AcpClientConnection["loadSession"]>(
    async ({ sessionId }) => {
      const emit = (update: SessionNotification["update"]) =>
        adapter.handlers!.sessionUpdate({ sessionId, update });
      await emit({
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text: "question" },
      });
      for (let index = 0; index < 1_000; index += 1) {
        await emit({
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "word " },
        });
      }
      await emit({
        sessionUpdate: "tool_call",
        toolCallId: "tool",
        title: "Read file",
        status: "pending",
      });
      await emit({ sessionUpdate: "tool_call_update", toolCallId: "tool", status: "completed" });
      replaySent.resolve();
      await finishLoad.promise;
      return {};
    },
  );
  const controller = new AcpThreadController({
    connection: { type: "adapter", adapter },
    workspace: { cwd: "/workspace" },
  });
  await controller.connect();
  const snapshots: ReturnType<typeof projectAcpThreadMessages>[] = [];
  controller.subscribe(() => snapshots.push(projectAcpThreadMessages(controller.getState())));

  const loading = controller.reloadSession("s1");
  await replaySent.promise;
  expect(snapshots).toHaveLength(1);
  expect(snapshots[0]).toEqual([]);
  finishLoad.resolve();
  await loading;
  expect(projectAcpThreadMessages(controller.getState())).toHaveLength(2);
  expect(projectAcpThreadMessages(controller.getState())[1]?.status?.type).toBe("complete");
  expect(snapshots.filter((snapshot) => snapshot.length === 2)).toHaveLength(1);

  const published = snapshots.length;
  await adapter.handlers!.sessionUpdate({
    sessionId: "s1",
    update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "live" } },
  });
  expect(snapshots).toHaveLength(published + 1);
  expect(projectAcpThreadMessages(controller.getState())[1]?.status?.type).toBe("running");
  controller.dispose();
});

it("discards a failed load replay and retains the previous transcript", async () => {
  const adapter = new ConformanceAdapter();
  const controller = new AcpThreadController({
    connection: { type: "adapter", adapter },
    workspace: { cwd: "/workspace" },
  });
  await controller.connect();
  await controller.selectSession("s1");
  const before = projectAcpThreadMessages(controller.getState());
  adapter.connection.loadSession = vi.fn<AcpClientConnection["loadSession"]>(
    async ({ sessionId }) => {
      await adapter.handlers!.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "discard me" },
        },
      });
      throw new Error("load failed");
    },
  );

  await expect(controller.reloadSession("s1")).rejects.toThrow("load failed");
  expect(projectAcpThreadMessages(controller.getState())).toEqual(before);
  controller.dispose();
});
