import type { SessionNotification } from "@agentclientprotocol/sdk";
import { describe, expect, it, vi } from "vitest";
import { AcpThreadController, type AcpRuntimeExtensionAdapter } from "../src/core";
import { ConformanceAdapter } from "./fixture";

const extensions: AcpRuntimeExtensionAdapter = {
  turnState(notification) {
    const turn = notification.update._meta?.turn;
    if (turn === "started") return { running: true };
    if (turn === "stopped") return { running: false, stopReason: "cancelled" };
    if (turn === "failed") return { running: false, error: "worker failed" };
  },
};
const marker = (value: string): SessionNotification => ({
  sessionId: "s1",
  update: { sessionUpdate: "session_info_update", _meta: { turn: value } },
});
const text = (value: string): SessionNotification => ({
  sessionId: "s1",
  update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: value } },
});

function harness() {
  const adapter = new ConformanceAdapter();
  vi.mocked(adapter.connection.loadSession).mockImplementation(async () => {
    await adapter.handlers?.sessionUpdate(marker("started"));
    await adapter.handlers?.sessionUpdate(text("Working"));
    return {};
  });
  const controller = new AcpThreadController({
    connection: { type: "adapter", adapter },
    workspace: { cwd: "/workspace" },
    extensions,
  });
  return {
    adapter,
    controller,
    emit: async (notification: SessionNotification) => {
      await adapter.handlers?.sessionUpdate(notification);
    },
  };
}

describe("application-owned observed turn lifecycle", () => {
  it("keeps a replayed active turn running and rejects overlapping prompts", async () => {
    const { controller } = harness();
    await controller.connect();
    await controller.selectSession("s1");
    expect(controller.getState().sessions.s1?.runState).toBe("running");
    expect(controller.getState().sessions.s1?.messages.at(-1)?.status).toEqual({ type: "running" });
    await expect(
      controller.prompt("s1", [{ type: "text", text: "overlap" }]),
    ).rejects.toMatchObject({ code: "ACP_TURN_RUNNING" });
    controller.dispose();
  });

  it("cancels an observed turn through the normal controller and finishes on its marker", async () => {
    const { controller, adapter, emit } = harness();
    await controller.connect();
    await controller.selectSession("s1");
    await controller.cancel("s1");
    expect(adapter.connection.cancel).toHaveBeenCalledWith("s1");
    expect(controller.getState().sessions.s1?.runState).toBe("cancelling");
    await emit(marker("started"));
    await emit(text("Still stopping"));
    expect(controller.getState().sessions.s1?.runState).toBe("cancelling");
    expect(controller.getState().sessions.s1?.turn).toBe(1);
    expect(controller.getState().sessions.s1?.messages).toHaveLength(1);
    await emit(marker("stopped"));
    expect(controller.getState().sessions.s1?.runState).toBe("idle");
    expect(controller.getState().sessions.s1?.messages.at(-1)?.status).toMatchObject({
      type: "incomplete",
      stopReason: "cancelled",
    });
    await controller.prompt("s1", [{ type: "text", text: "new direction" }]);
    expect(controller.getState().sessions.s1?.runState).toBe("idle");
    controller.dispose();
  });

  it("starts separate messages for background turns and retains turn failures", async () => {
    const { controller, emit } = harness();
    await controller.connect();
    await controller.selectSession("s1");
    await emit(marker("stopped"));
    await emit(marker("started"));
    await emit(text("Next turn"));
    await emit(marker("started"));
    expect(controller.getState().sessions.s1?.messages).toHaveLength(2);
    expect(controller.getState().sessions.s1?.turn).toBe(2);
    await emit(marker("failed"));
    expect(controller.getState().sessions.s1?.runState).toBe("idle");
    expect(controller.getState().sessions.s1?.error).toBe("worker failed");
    expect(controller.getState().sessions.s1?.messages.at(-1)?.status).toMatchObject({
      type: "incomplete",
      error: "worker failed",
    });
    controller.dispose();
  });

  it("waits for a local prompt response even if its stop marker arrives first", async () => {
    const { controller, adapter, emit } = harness();
    await controller.connect();
    await controller.selectSession("s1");
    await emit(marker("stopped"));
    let finish!: () => void;
    vi.mocked(adapter.connection.prompt).mockImplementation(async () => {
      await emit(marker("started"));
      await emit(text("Local answer"));
      await emit(marker("stopped"));
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return { stopReason: "cancelled" };
    });
    const prompt = controller.prompt("s1", [{ type: "text", text: "local prompt" }]);
    while (!finish) await Promise.resolve();
    expect(controller.getState().sessions.s1?.runState).toBe("running");
    await expect(
      controller.prompt("s1", [{ type: "text", text: "too early" }]),
    ).rejects.toMatchObject({ code: "ACP_TURN_RUNNING" });
    await controller.cancel("s1");
    expect(controller.getState().sessions.s1?.runState).toBe("cancelling");
    finish();
    await prompt;
    expect(controller.getState().sessions.s1?.runState).toBe("idle");
    controller.dispose();
  });

  it("failed cancellation restores running state so the user can retry", async () => {
    const { controller, adapter, emit } = harness();
    await controller.connect();
    await controller.selectSession("s1");
    vi.mocked(adapter.connection.cancel).mockRejectedValueOnce(new Error("cancel failed"));
    await expect(controller.cancel("s1")).rejects.toThrow("cancel failed");
    expect(controller.getState().sessions.s1?.runState).toBe("running");
    await controller.cancel("s1");
    await emit(marker("stopped"));
    expect(controller.getState().sessions.s1?.runState).toBe("idle");
    controller.dispose();
  });
});
