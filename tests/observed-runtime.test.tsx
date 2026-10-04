import { AssistantRuntimeProvider, ComposerPrimitive, useAuiState } from "@assistant-ui/react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useAcpRuntime } from "../src";
import type { AcpRuntimeExtensionAdapter } from "../src/core";
import { ConformanceAdapter } from "./fixture";

const extensions: AcpRuntimeExtensionAdapter = {
  turnState({ update }) {
    const running = update._meta?.running;
    return typeof running === "boolean" ? { running } : undefined;
  },
};

it("native assistant-ui composer and Stop work for a turn observed after loading", async () => {
  const adapter = new ConformanceAdapter();
  vi.mocked(adapter.connection.loadSession).mockImplementation(async ({ sessionId }) => {
    await adapter.handlers?.sessionUpdate({
      sessionId,
      update: { sessionUpdate: "session_info_update", _meta: { running: true } },
    });
    await adapter.handlers?.sessionUpdate({
      sessionId,
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Working" } },
    });
    return {};
  });
  function Composer() {
    const running = useAuiState((state) => state.thread.isRunning);
    return (
      <>
        <output data-testid="running">{String(running)}</output>
        <ComposerPrimitive.Root>
          <ComposerPrimitive.Input aria-label="Message" />
          <ComposerPrimitive.Cancel>Stop</ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send>Send</ComposerPrimitive.Send>
        </ComposerPrimitive.Root>
      </>
    );
  }
  function Runtime() {
    const runtime = useAcpRuntime({
      connection: { type: "adapter", adapter },
      workspace: { cwd: "/workspace" },
      threadId: "s1",
      extensions,
    });
    return (
      <AssistantRuntimeProvider runtime={runtime}>
        <Composer />
      </AssistantRuntimeProvider>
    );
  }
  const view = render(<Runtime />);
  await waitFor(() => expect(screen.getByTestId("running").textContent).toBe("true"));
  const input = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Message" });
  expect(input.disabled).toBe(false);
  fireEvent.change(input, { target: { value: "Please change direction" } });
  expect(screen.getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Stop" }));
  await waitFor(() => expect(adapter.connection.cancel).toHaveBeenCalledWith("s1"));
  expect(screen.getByTestId("running").textContent).toBe("true");
  await act(async () => {
    await adapter.handlers?.sessionUpdate({
      sessionId: "s1",
      update: { sessionUpdate: "session_info_update", _meta: { running: false } },
    });
  });
  await waitFor(() => expect(screen.getByTestId("running").textContent).toBe("false"));
  expect(input.value).toBe("Please change direction");
  expect(screen.getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() =>
    expect(adapter.connection.prompt).toHaveBeenCalledWith({
      sessionId: "s1",
      prompt: [{ type: "text", text: "Please change direction" }],
    }),
  );
  view.unmount();
});
