import { ExportedMessageRepository } from '@assistant-ui/react';
import { client, methods, RequestError, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';

// src/core/errors.ts
var AcpError = class extends Error {
  /** Stable machine-readable error code. */
  code;
  /** Original failure, when the error wraps another exception. */
  cause;
  /** Creates an ACP error with a stable code and optional original cause. */
  constructor(code, message, cause) {
    super(message);
    this.name = "AcpError";
    this.code = code;
    this.cause = cause;
  }
};
var AcpCapabilityError = class extends AcpError {
  /** Creates an error for an operation not advertised by the connected agent. */
  constructor(capability, message) {
    super(
      "ACP_CAPABILITY_UNAVAILABLE",
      message ?? `The ACP agent did not advertise '${capability}'.`
    );
    this.name = "AcpCapabilityError";
  }
};
var AcpUnsupportedContentError = class extends AcpError {
  /** The unsupported assistant-ui content kind. */
  contentType;
  /** Creates an error for an assistant-ui content kind that ACP cannot accept. */
  constructor(contentType, message) {
    super(
      "ACP_UNSUPPORTED_CONTENT",
      message ?? `Cannot serialize assistant-ui content '${contentType}' to ACP.`
    );
    this.name = "AcpUnsupportedContentError";
    this.contentType = contentType;
  }
};
var AcpInvalidWorkspaceError = class extends AcpError {
  /** Creates an error for a relative workspace path. */
  constructor(path) {
    super("ACP_INVALID_WORKSPACE", `ACP workspace paths must be absolute: ${path}`);
    this.name = "AcpInvalidWorkspaceError";
  }
};

// src/core/state.ts
var createAcpThreadState = () => ({
  connectionStatus: "idle",
  authMethods: [],
  sessions: {},
  sessionOrder: []
});
var createAcpSessionState = (sessionId) => ({
  sessionId,
  runState: "idle",
  access: { mode: "read-write" },
  messages: [],
  tools: {},
  permissions: {},
  commands: [],
  configOptions: [],
  turn: 0,
  latestNotifications: {},
  unhandledNotifications: []
});
var updateSession = (state, sessionId, update) => {
  const current = state.sessions[sessionId] ?? createAcpSessionState(sessionId);
  return {
    ...state,
    sessions: { ...state.sessions, [sessionId]: update(current) },
    sessionOrder: state.preparedSessionId === sessionId ? state.sessionOrder.filter((id) => id !== sessionId) : state.sessionOrder.includes(sessionId) ? state.sessionOrder : [...state.sessionOrder, sessionId]
  };
};
var appendMessage = (session, message) => ({
  ...session,
  messages: [...session.messages, message]
});
var patchMessage = (session, messageId, patch) => ({
  ...session,
  messages: session.messages.map(
    (message) => message.id === messageId ? patch(message) : message
  )
});
var localMessageId = (session, role) => `${session.sessionId}:turn:${session.turn}:${role}:${session.messages.length}`;
var ensureMessage = (session, role, protocolMessageId) => {
  const exactId = protocolMessageId ?? void 0;
  const exactMessage = exactId ? session.messages.find(
    (message) => message.id === exactId || message.protocolMessageId === exactId
  ) : void 0;
  if (exactMessage) return [session, exactMessage.id];
  if (!exactId && session.lastChunk?.role === role) {
    return [session, session.lastChunk.messageId];
  }
  const messageId = exactId ?? localMessageId(session, role);
  const next = appendMessage(session, {
    id: messageId,
    ...exactId ? { protocolMessageId: exactId } : {},
    role,
    createdAt: Date.now(),
    pieces: [],
    rawNotifications: [],
    ...role === "assistant" ? { status: { type: "running" } } : {}
  });
  return [
    {
      ...next,
      lastChunk: { role, messageId },
      lastAssistantMessageId: role === "assistant" ? messageId : void 0
    },
    messageId
  ];
};
var appendPiece = (session, messageId, piece) => patchMessage(session, messageId, (message) => ({
  ...message,
  pieces: [...message.pieces, piece]
}));
var appendMessageNotification = (session, messageId, notification) => patchMessage(session, messageId, (message) => ({
  ...message,
  rawNotifications: [...message.rawNotifications, notification]
}));
var finiteTimestamp = (value) => value !== void 0 && Number.isFinite(value) ? value : void 0;
var applyMessageState = (session, messageId, notification, extensions) => {
  const state = extensions?.messageState?.(notification);
  if (!state) return session;
  const sentAt = finiteTimestamp(state.sentAt);
  const finishedAt = finiteTimestamp(state.finishedAt);
  if (sentAt === void 0 && finishedAt === void 0 && state.status === void 0)
    return session;
  return patchMessage(session, messageId, (message) => ({
    ...message,
    ...sentAt !== void 0 ? { sentAt } : {},
    ...finishedAt !== void 0 ? { finishedAt } : {},
    ...state.status !== void 0 ? { status: state.status } : {}
  }));
};
var mergeTool = (existing, incoming, messageId, notification, displayUpdate) => {
  const value = existing ? { ...existing.value, ...incoming } : incoming;
  const display = displayUpdate ? {
    output: (existing?.display?.output ?? "") + (displayUpdate.outputDelta ?? ""),
    cwd: displayUpdate.cwd ?? existing?.display?.cwd,
    exitCode: displayUpdate.exitCode ?? existing?.display?.exitCode
  } : existing?.display;
  return {
    toolCallId: incoming.toolCallId,
    messageId,
    value,
    ...existing?.permission ? { permission: existing.permission } : {},
    ...display ? { display } : {},
    rawNotifications: notification ? [...existing?.rawNotifications ?? [], notification] : existing?.rawNotifications ?? []
  };
};
var recordLatestNotification = (session, notification) => ({
  ...session,
  latestNotifications: {
    ...session.latestNotifications,
    [notification.update.sessionUpdate]: notification
  }
});
var reduceNotification = (session, notification, extensions) => {
  const update = notification.update;
  switch (update.sessionUpdate) {
    case "user_message_chunk":
    case "agent_message_chunk":
    case "agent_thought_chunk": {
      const role = update.sessionUpdate === "user_message_chunk" ? "user" : "assistant";
      const [withMessage, messageId] = ensureMessage(session, role, update.messageId);
      const withPiece = appendPiece(withMessage, messageId, {
        type: "content",
        content: update.content,
        notification
      });
      return applyMessageState(
        appendMessageNotification(withPiece, messageId, notification),
        messageId,
        notification,
        extensions
      );
    }
    case "tool_call":
    case "tool_call_update": {
      let current = session;
      let messageId = session.tools[update.toolCallId]?.messageId ?? session.lastAssistantMessageId;
      if (!messageId) [current, messageId] = ensureMessage(session, "assistant");
      const existing = current.tools[update.toolCallId];
      const nextTools = {
        ...current.tools,
        [update.toolCallId]: mergeTool(
          existing,
          update,
          messageId,
          notification,
          extensions?.toolDisplay?.(notification)
        )
      };
      const alreadyLinked = current.messages.find((message) => message.id === messageId)?.pieces.some((piece) => piece.type === "tool" && piece.toolCallId === update.toolCallId);
      const linked = alreadyLinked ? current : appendPiece(current, messageId, { type: "tool", toolCallId: update.toolCallId });
      return {
        ...applyMessageState(linked, messageId, notification, extensions),
        tools: nextTools,
        lastAssistantMessageId: messageId
      };
    }
    case "plan": {
      let current = session;
      let messageId = session.lastAssistantMessageId;
      if (!messageId) [current, messageId] = ensureMessage(session, "assistant");
      const withPlan = appendPiece(current, messageId, {
        type: "plan",
        plan: update,
        notification
      });
      return recordLatestNotification(
        applyMessageState(
          appendMessageNotification({ ...withPlan, plan: update }, messageId, notification),
          messageId,
          notification,
          extensions
        ),
        notification
      );
    }
    case "available_commands_update":
      return recordLatestNotification(
        { ...session, commands: update.availableCommands },
        notification
      );
    case "current_mode_update":
      return recordLatestNotification(
        session.modes ? { ...session, modes: { ...session.modes, currentModeId: update.currentModeId } } : session,
        notification
      );
    case "config_option_update":
      return recordLatestNotification(
        { ...session, configOptions: update.configOptions },
        notification
      );
    case "session_info_update":
      return recordLatestNotification(
        {
          ...session,
          info: {
            sessionId: session.sessionId,
            cwd: session.info?.cwd ?? "",
            ...session.info,
            ...update.title !== void 0 ? { title: update.title ?? void 0 } : {},
            ...update.updatedAt !== void 0 ? { updatedAt: update.updatedAt ?? void 0 } : {}
          }
        },
        notification
      );
    case "usage_update":
      return recordLatestNotification({ ...session, usage: update }, notification);
    default: {
      let current = session;
      let messageId = session.lastAssistantMessageId;
      if (!messageId) [current, messageId] = ensureMessage(session, "assistant");
      const withUnsupported = appendPiece(current, messageId, {
        type: "unsupported",
        notification
      });
      const withState = applyMessageState(
        appendMessageNotification(withUnsupported, messageId, notification),
        messageId,
        notification,
        extensions
      );
      return {
        ...withState,
        unhandledNotifications: [...current.unhandledNotifications, notification]
      };
    }
  }
};
var statusFromStopReason = (stopReason) => stopReason === "end_turn" ? { type: "complete", stopReason } : { type: "incomplete", stopReason };
var finalizeAssistantMessage = (session, stopReason) => {
  if (!session.lastAssistantMessageId) return session;
  return patchMessage(session, session.lastAssistantMessageId, (message) => ({
    ...message,
    finishedAt: Date.now(),
    status: statusFromStopReason(stopReason)
  }));
};
var failAssistantMessage = (session, error) => {
  if (!session.lastAssistantMessageId) return session;
  return patchMessage(session, session.lastAssistantMessageId, (message) => ({
    ...message,
    finishedAt: Date.now(),
    status: { type: "incomplete", error }
  }));
};
function reduceAcpThreadState(state, event, extensions) {
  switch (event.type) {
    case "connection.status":
      return {
        ...state,
        connectionStatus: event.status,
        ...event.error !== void 0 ? { connectionError: event.error } : {}
      };
    case "connection.initialized":
      return {
        ...state,
        initializeResponse: event.response,
        capabilities: event.response.agentCapabilities,
        authMethods: event.response.authMethods ?? [],
        connectionStatus: (event.response.authMethods?.length ?? 0) > 0 ? "connecting" : "ready"
      };
    case "sessions.listed": {
      const sessions = {};
      for (const info of event.sessions) {
        sessions[info.sessionId] = {
          ...state.sessions[info.sessionId] ?? createAcpSessionState(info.sessionId),
          info
        };
      }
      const active = state.activeSessionId;
      if (active && !sessions[active] && state.sessions[active])
        sessions[active] = state.sessions[active];
      const listedOrder = event.sessions.map((info) => info.sessionId).filter((sessionId) => sessionId !== state.preparedSessionId);
      return {
        ...state,
        sessions,
        sessionOrder: active && active !== state.preparedSessionId && !listedOrder.includes(active) ? [...listedOrder, active] : listedOrder
      };
    }
    case "session.preparing": {
      const prepared = {
        ...state,
        preparedSessionId: event.sessionId,
        sessionOrder: state.sessionOrder.filter((id) => id !== event.sessionId)
      };
      return updateSession(prepared, event.sessionId, (session) => session);
    }
    case "session.attached":
      return updateSession(state, event.sessionId, (session) => ({
        ...session,
        ...event.info ? { info: event.info } : {},
        ...event.modes !== void 0 ? { modes: event.modes } : {},
        access: event.access ?? { mode: "read-write" },
        configOptions: event.configOptions ?? session.configOptions,
        runState: "idle",
        error: void 0
      }));
    case "session.committed":
      return {
        ...state,
        preparedSessionId: state.preparedSessionId === event.sessionId ? void 0 : state.preparedSessionId,
        sessionOrder: state.sessionOrder.includes(event.sessionId) ? state.sessionOrder : [...state.sessionOrder, event.sessionId]
      };
    case "session.prepared_cleared":
      if (state.preparedSessionId !== event.sessionId) return state;
      const remainingSessions = { ...state.sessions };
      delete remainingSessions[event.sessionId];
      return {
        ...state,
        sessions: remainingSessions,
        preparedSessionId: void 0,
        sessionOrder: state.sessionOrder.filter((id) => id !== event.sessionId),
        ...state.activeSessionId === event.sessionId ? { activeSessionId: void 0 } : {}
      };
    case "session.selected":
      return { ...state, activeSessionId: event.sessionId };
    case "session.compacted":
      return updateSession(state, event.sessionId, (session) => ({
        ...createAcpSessionState(event.sessionId),
        ...session.info ? { info: session.info } : {},
        access: session.access,
        ...session.modes !== void 0 ? { modes: session.modes } : {},
        configOptions: session.configOptions
      }));
    case "session.deleted": {
      const sessions = { ...state.sessions };
      delete sessions[event.sessionId];
      return {
        ...state,
        sessions,
        sessionOrder: state.sessionOrder.filter((id) => id !== event.sessionId),
        ...state.preparedSessionId === event.sessionId ? { preparedSessionId: void 0 } : {},
        ...state.activeSessionId === event.sessionId ? { activeSessionId: void 0 } : {}
      };
    }
    case "session.loading":
      return updateSession(state, event.sessionId, (session) => ({
        ...event.clearHistory ? { ...createAcpSessionState(event.sessionId), info: session.info } : session,
        runState: "loading",
        error: void 0
      }));
    case "session.restored":
      return updateSession(state, event.session.sessionId, () => ({
        ...event.session,
        ...event.error !== void 0 ? { runState: "error", error: event.error } : {}
      }));
    case "session.attach_failed":
      return updateSession(state, event.sessionId, (session) => ({
        ...session,
        runState: "error",
        error: event.error
      }));
    case "session.closed":
      return updateSession(state, event.sessionId, (session) => ({
        ...session,
        runState: "idle",
        error: void 0
      }));
    case "session.config_options":
      return updateSession(state, event.sessionId, (session) => ({
        ...session,
        configOptions: event.configOptions
      }));
    case "session.prompt_started":
      return updateSession(state, event.sessionId, (session) => ({
        ...session,
        runState: "running",
        turn: session.turn + 1,
        lastChunk: void 0,
        lastAssistantMessageId: void 0,
        error: void 0
      }));
    case "session.prompt_stopped":
      return updateSession(state, event.sessionId, (session) => ({
        ...finalizeAssistantMessage(session, event.response.stopReason),
        runState: "idle",
        lastChunk: void 0
      }));
    case "session.turn_failed":
      return updateSession(state, event.sessionId, (session) => ({
        ...failAssistantMessage(session, event.error),
        runState: "idle",
        error: event.error
      }));
    case "session.cancel_started":
      return updateSession(state, event.sessionId, (session) => ({
        ...session,
        runState: "cancelling"
      }));
    case "session.update":
      return updateSession(
        state,
        event.notification.sessionId,
        (session) => reduceNotification(session, event.notification, extensions)
      );
    case "message.optimistic":
      return updateSession(
        state,
        event.sessionId,
        (session) => appendMessage(session, event.message)
      );
    case "message.optimistic_failed":
      return updateSession(
        state,
        event.sessionId,
        (session) => patchMessage(session, event.messageId, (message) => ({
          ...message,
          error: event.error,
          optimistic: false
        }))
      );
    case "message.optimistic_confirmed":
      return updateSession(
        state,
        event.sessionId,
        (session) => patchMessage(session, event.messageId, (message) => ({
          ...message,
          optimistic: false,
          ...event.protocolMessageId ? { protocolMessageId: event.protocolMessageId } : {},
          rawNotifications: [...message.rawNotifications, ...event.notifications ?? []]
        }))
      );
    case "permission.requested":
      return updateSession(state, event.request.sessionId, (session) => {
        const record = { request: event.request, status: "pending" };
        let current = session;
        let messageId = session.lastAssistantMessageId;
        if (!messageId) [current, messageId] = ensureMessage(session, "assistant");
        const toolCallId = event.request.toolCall.toolCallId;
        const existing = current.tools[toolCallId];
        const tool = mergeTool(existing, event.request.toolCall, messageId);
        const alreadyLinked = current.messages.find((message) => message.id === messageId)?.pieces.some((piece) => piece.type === "tool" && piece.toolCallId === toolCallId);
        if (!alreadyLinked) current = appendPiece(current, messageId, { type: "tool", toolCallId });
        return {
          ...current,
          permissions: { ...current.permissions, [toolCallId]: record },
          tools: { ...current.tools, [toolCallId]: { ...tool, permission: record } },
          lastAssistantMessageId: messageId
        };
      });
    case "permission.resolved":
      return updateSession(state, event.sessionId, (session) => {
        const current = session.permissions[event.toolCallId];
        if (!current) return session;
        const permission = {
          ...current,
          status: event.response.outcome.outcome === "cancelled" ? "cancelled" : "resolved",
          response: event.response
        };
        const tool = session.tools[event.toolCallId];
        return {
          ...session,
          permissions: { ...session.permissions, [event.toolCallId]: permission },
          tools: tool ? { ...session.tools, [event.toolCallId]: { ...tool, permission } } : session.tools
        };
      });
  }
}
var hasAgentCapability = (capabilities, capability) => {
  switch (capability) {
    case "load":
      return capabilities?.loadSession === true;
    case "list":
      return capabilities?.sessionCapabilities?.list != null;
    case "delete":
      return capabilities?.sessionCapabilities?.delete != null;
    case "resume":
      return capabilities?.sessionCapabilities?.resume != null;
    case "close":
      return capabilities?.sessionCapabilities?.close != null;
    case "logout":
      return capabilities?.auth?.logout != null;
  }
};

// src/core/internal-errors.ts
var primitiveErrorMessage = (value) => typeof value === "symbol" ? value.description ?? "Symbol" : String(value);
function errorMessage(error) {
  if (error instanceof Error) return error.message;
  if (typeof error === "bigint" || typeof error === "boolean" || typeof error === "number" || typeof error === "string" || typeof error === "symbol") {
    return primitiveErrorMessage(error);
  }
  if (error === null) return "null";
  if (error === void 0) return "undefined";
  try {
    return JSON.stringify(error) ?? "Unknown error";
  } catch {
    return "Unknown error";
  }
}
var toError = (error) => error instanceof Error ? error : new Error(errorMessage(error));

// src/core/projection.ts
var dataPart = (name, data) => ({
  type: "data",
  name,
  data
});
var toDataUrl = (mimeType, data) => `data:${mimeType};base64,${data}`;
var piecePhase = (piece, extensions) => {
  if (piece.type !== "content") return void 0;
  return piece.notification ? extensions?.messagePhase?.(piece.notification) : void 0;
};
function projectContent(content, reasoning) {
  switch (content.type) {
    case "text":
      return reasoning ? { type: "reasoning", text: content.text } : { type: "text", text: content.text };
    case "image":
      return {
        type: "image",
        image: content.uri ?? toDataUrl(content.mimeType, content.data)
      };
    case "audio":
      return {
        type: "file",
        filename: "audio",
        data: content.data,
        mimeType: content.mimeType
      };
    case "resource_link":
      return /^https?:\/\//i.test(content.uri) ? {
        type: "source",
        sourceType: "url",
        id: content.uri,
        url: content.uri,
        title: content.title ?? content.name
      } : dataPart("acp-resource-link", content);
    case "resource":
      return "blob" in content.resource ? {
        type: "file",
        filename: content.resource.uri,
        data: content.resource.blob,
        mimeType: content.resource.mimeType ?? "application/octet-stream"
      } : dataPart("acp-resource", content);
    default:
      return dataPart("acp-unsupported", {
        reason: "unknown-content-block",
        content
      });
  }
}
var approvalKind = (kind) => kind.replaceAll("_", "-");
var projectToolApproval = (tool) => {
  const permission = tool.permission;
  if (!permission) return void 0;
  const options = permission.request.options.map((option) => ({
    id: option.optionId,
    kind: approvalKind(option.kind),
    label: option.name
  }));
  if (permission.status === "pending") {
    return { id: tool.toolCallId, options };
  }
  if (permission.status === "cancelled" || permission.response?.outcome.outcome === "cancelled") {
    return { id: tool.toolCallId, options, resolution: "cancelled" };
  }
  const optionId = permission.response?.outcome.outcome === "selected" ? permission.response.outcome.optionId : void 0;
  const selected = permission.request.options.find((option) => option.optionId === optionId);
  return {
    id: tool.toolCallId,
    options,
    optionId,
    approved: selected?.kind.startsWith("allow") ?? false
  };
};
var normalizeObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value) ? value : value === void 0 ? {} : { value };
var normalizeToolContent = (content) => content?.map((part) => {
  if (part.type === "diff") return { ...part, type: "diff" };
  if (part.type === "terminal") return { ...part, type: "terminal" };
  return { type: "content", content: part.content };
});
function projectTool(tool) {
  const value = tool.value;
  const status = value.status;
  const rawInput = value.rawInput;
  const rawOutput = value.rawOutput;
  const args = normalizeObject(rawInput);
  const content = normalizeToolContent(value.content);
  const result = rawOutput !== void 0 ? rawOutput : status === "completed" || status === "failed" ? content : void 0;
  const kind = value.kind ?? "other";
  return {
    type: "tool-call",
    toolCallId: tool.toolCallId,
    toolName: `acp:${kind}`,
    args,
    argsText: JSON.stringify(args),
    ...result !== void 0 ? { result } : {},
    ...status === "failed" ? { isError: true } : {},
    artifact: {
      acp: {
        title: value.title,
        kind,
        status,
        content,
        locations: value.locations,
        rawInput,
        rawOutput,
        display: tool.display,
        rawNotifications: tool.rawNotifications
      }
    },
    ...projectToolApproval(tool) ? { approval: projectToolApproval(tool) } : {}
  };
}
var projectPiece = (session, messageId, piece, rawPieceIndex, phase) => {
  switch (piece.type) {
    case "content": {
      const projected = projectContent(
        piece.content,
        piece.notification?.update.sessionUpdate === "agent_thought_chunk"
      );
      if (projected.type !== "text" && projected.type !== "reasoning") return projected;
      return {
        ...projected,
        providerMetadata: {
          ...projected.providerMetadata,
          acp: {
            phase: phase ?? null,
            rawPieceIndices: [rawPieceIndex],
            rawPieceRefs: [{ messageId, pieceIndex: rawPieceIndex }]
          }
        }
      };
    }
    case "tool": {
      const tool = session.tools[piece.toolCallId];
      return tool ? projectTool(tool) : dataPart("acp-unsupported", {
        reason: "missing-tool-call",
        toolCallId: piece.toolCallId
      });
    }
    case "plan":
      return dataPart("acp-plan", piece.plan);
    case "unsupported":
      return dataPart("acp-unsupported", piece.notification.update);
  }
};
var projectMessagePieces = (session, messages, extensions) => {
  const projected = [];
  let pending;
  const flushPending = () => {
    if (!pending) return;
    projected.push({
      type: pending.type,
      text: pending.text.join(""),
      providerMetadata: {
        acp: {
          phase: pending.phase,
          rawPieceIndices: pending.rawPieceIndices,
          rawPieceRefs: pending.rawPieceRefs
        }
      }
    });
    pending = void 0;
  };
  for (const message of messages) {
    let activeType;
    let activePhase;
    for (const [rawPieceIndex, piece] of message.pieces.entries()) {
      const content = piece.type === "content" ? piece.content : void 0;
      const type = content?.type === "text" ? piece.type === "content" && piece.notification?.update.sessionUpdate === "agent_thought_chunk" ? "reasoning" : "text" : void 0;
      if (!type) {
        activeType = void 0;
        activePhase = void 0;
      } else {
        if (activeType !== type) activePhase = void 0;
        activeType = type;
        activePhase = piecePhase(piece, extensions) ?? activePhase;
      }
      if (message.role === "assistant" && type && content?.type === "text") {
        const phase = activePhase ?? null;
        if (!pending || pending.type !== type || pending.phase !== phase) {
          flushPending();
          pending = {
            type,
            phase,
            text: [],
            rawPieceIndices: [],
            rawPieceRefs: []
          };
        }
        pending.text.push(content.text);
        pending.rawPieceIndices.push(rawPieceIndex);
        pending.rawPieceRefs.push({ messageId: message.id, pieceIndex: rawPieceIndex });
        continue;
      }
      flushPending();
      const next = projectPiece(session, message.id, piece, rawPieceIndex, activePhase);
      projected.push(next);
    }
  }
  flushPending();
  return projected;
};
var statusForMessage = (message) => {
  if (message.role !== "assistant") return void 0;
  const status = message.status;
  if (!status || status.type === "running") return { type: "running" };
  if (status.type === "complete") {
    return { type: "complete", reason: "stop" };
  }
  switch (status.stopReason) {
    case "max_tokens":
      return { type: "incomplete", reason: "length" };
    case "cancelled":
      return { type: "incomplete", reason: "cancelled" };
    default:
      return {
        type: "incomplete",
        reason: status.error ? "error" : "other",
        ...status.error ? { error: errorMessage(status.error) } : {}
      };
  }
};
var projectMessage = (session, messages, extensions) => {
  const message = messages[0];
  const latest = messages.at(-1) ?? message;
  const messageIds = messages.map((candidate) => candidate.id);
  const protocolMessageIds = [
    ...new Set(
      messages.flatMap(
        (candidate) => candidate.protocolMessageId ? [candidate.protocolMessageId] : []
      )
    )
  ];
  let latestError;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const candidate = messages[index];
    if (candidate?.error === void 0) continue;
    latestError = candidate.error;
    break;
  }
  return {
    id: message.id,
    role: message.role,
    createdAt: new Date(message.createdAt),
    content: projectMessagePieces(session, messages, extensions),
    ...statusForMessage(latest) ? { status: statusForMessage(latest) } : {},
    metadata: {
      isOptimistic: messages.some((candidate) => candidate.optimistic),
      custom: {
        acp: {
          sessionId: session.sessionId,
          protocolMessageId: message.protocolMessageId,
          messageIds,
          protocolMessageIds,
          notifications: messages.flatMap((candidate) => candidate.rawNotifications),
          stopReason: latest.status?.type === "complete" || latest.status?.type === "incomplete" ? latest.status.stopReason : void 0,
          error: latestError ? errorMessage(latestError) : void 0
        }
      }
    }
  };
};
var sameReferences = (left, right) => left.length === right.length && left.every((value, index) => value === right[index]);
var referencedTools = (session, messages) => messages.flatMap(
  (message) => message.pieces.flatMap(
    (piece) => piece.type === "tool" ? [session.tools[piece.toolCallId]] : []
  )
);
var AcpProjectionCache = class {
  entries = /* @__PURE__ */ new Map();
  extensions = void 0;
  begin(extensions) {
    if (this.extensions === extensions) return;
    this.entries.clear();
    this.extensions = extensions;
  }
  project(session, messages, extensions) {
    const key = messages[0].id;
    const tools = referencedTools(session, messages);
    const cached = this.entries.get(key);
    if (cached && sameReferences(cached.messages, messages) && sameReferences(cached.tools, tools)) {
      return cached.projected;
    }
    const projected = projectMessage(session, messages, extensions);
    this.entries.set(key, { messages: [...messages], tools, projected });
    return projected;
  }
  retain(keys) {
    for (const key of this.entries.keys()) {
      if (!keys.has(key)) this.entries.delete(key);
    }
  }
};
function projectAcpSessionMessages(session, extensions, cache) {
  if (!session) return [];
  cache?.begin(extensions);
  const projected = [];
  const retainedKeys = /* @__PURE__ */ new Set();
  for (let index = 0; index < session.messages.length; ) {
    const message = session.messages[index];
    if (!message) break;
    if (message.role === "user") {
      retainedKeys.add(message.id);
      projected.push(
        cache?.project(session, [message], extensions) ?? projectMessage(session, [message], extensions)
      );
      index += 1;
      continue;
    }
    const assistantMessages = [message];
    let nextIndex = index + 1;
    while (session.messages[nextIndex]?.role === "assistant") {
      assistantMessages.push(session.messages[nextIndex]);
      nextIndex += 1;
    }
    retainedKeys.add(message.id);
    projected.push(
      cache?.project(session, assistantMessages, extensions) ?? projectMessage(session, assistantMessages, extensions)
    );
    index = nextIndex;
  }
  cache?.retain(retainedKeys);
  return projected;
}
function projectAcpSessionRepository(session, extensions, cache) {
  return ExportedMessageRepository.fromArray(projectAcpSessionMessages(session, extensions, cache));
}
function projectAcpThreadMessages(state, sessionId = state.activeSessionId, extensions) {
  if (!sessionId) return [];
  return projectAcpSessionMessages(state.sessions[sessionId], extensions);
}
function projectAcpThreadRepository(state, sessionId = state.activeSessionId, extensions) {
  if (!sessionId) return ExportedMessageRepository.fromArray([]);
  return projectAcpSessionRepository(state.sessions[sessionId], extensions);
}

// src/core/serialize.ts
var hasCompleteTerminalServices = (terminal) => Boolean(
  terminal && typeof terminal.create === "function" && typeof terminal.output === "function" && typeof terminal.release === "function" && typeof terminal.waitForExit === "function" && typeof terminal.kill === "function"
);
var isAbsolutePath = (value) => value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
function validateWorkspace(workspace) {
  for (const path of [workspace.cwd, ...workspace.additionalDirectories ?? []]) {
    if (!isAbsolutePath(path)) throw new AcpInvalidWorkspaceError(path);
  }
  for (const server of workspace.mcpServers ?? []) {
    if (!("type" in server) && !isAbsolutePath(server.command)) {
      throw new AcpInvalidWorkspaceError(server.command);
    }
  }
}
function buildClientCapabilities(services, additions) {
  const fs = services?.fileSystem;
  return {
    ...additions,
    fs: fs?.readTextFile || fs?.writeTextFile ? {
      readTextFile: Boolean(fs.readTextFile),
      writeTextFile: Boolean(fs.writeTextFile)
    } : void 0,
    terminal: hasCompleteTerminalServices(services?.terminal) ? true : void 0,
    session: {
      ...additions?.session,
      configOptions: { boolean: {} }
    }
  };
}
function buildSessionRequest(workspace, capabilities) {
  validateWorkspace(workspace);
  for (const server of workspace.mcpServers ?? []) {
    if (!("type" in server)) continue;
    if (server.type === "http" && capabilities?.mcpCapabilities?.http !== true) {
      throw new AcpCapabilityError("MCP HTTP transport");
    }
    if (server.type === "sse" && capabilities?.mcpCapabilities?.sse !== true) {
      throw new AcpCapabilityError("MCP SSE transport");
    }
    if (server.type === "acp") {
      throw new AcpCapabilityError(
        "MCP ACP transport",
        "The ACP MCP transport is UNSTABLE and is not enabled by react-acp."
      );
    }
  }
  return {
    cwd: workspace.cwd,
    mcpServers: [...workspace.mcpServers ?? []],
    ...workspace.additionalDirectories?.length && capabilities?.sessionCapabilities?.additionalDirectories != null ? { additionalDirectories: [...workspace.additionalDirectories] } : {}
  };
}
var parseDataUrl = (value) => {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(value);
  return match ? { mimeType: match[1], data: match[2] } : void 0;
};
var ensureCapability = (supported, contentType) => {
  if (!supported) {
    throw new AcpUnsupportedContentError(
      contentType,
      `The ACP agent did not advertise prompt support for '${contentType}'.`
    );
  }
};
function serializePart(part, capabilities) {
  switch (part.type) {
    case "text":
      return { type: "text", text: part.text };
    case "image": {
      ensureCapability(capabilities?.promptCapabilities?.image, "image");
      const parsed = parseDataUrl(part.image);
      if (parsed) return { type: "image", ...parsed };
      return {
        type: "image",
        data: "",
        mimeType: "application/octet-stream",
        uri: part.image
      };
    }
    case "file": {
      if (part.mimeType.startsWith("audio/")) {
        ensureCapability(capabilities?.promptCapabilities?.audio, "audio");
        const parsed = parseDataUrl(part.data);
        return {
          type: "audio",
          data: parsed?.data ?? part.data,
          mimeType: parsed?.mimeType ?? part.mimeType
        };
      }
      if (part.sourceType === "url" || /^https?:\/\//i.test(part.data)) {
        return {
          type: "resource_link",
          uri: part.data,
          name: part.filename ?? "resource",
          mimeType: part.mimeType
        };
      }
      ensureCapability(capabilities?.promptCapabilities?.embeddedContext, "embedded resource");
      return {
        type: "resource",
        resource: {
          uri: part.filename ?? "attachment",
          mimeType: part.mimeType,
          blob: part.data
        }
      };
    }
    case "audio": {
      ensureCapability(capabilities?.promptCapabilities?.audio, "audio");
      return {
        type: "audio",
        data: part.audio.data,
        mimeType: `audio/${part.audio.format}`
      };
    }
    case "data": {
      if (part.name === "acp-resource-link") {
        return part.data;
      }
      if (part.name === "acp-resource") {
        ensureCapability(capabilities?.promptCapabilities?.embeddedContext, "embedded resource");
        return part.data;
      }
      throw new AcpUnsupportedContentError(`data:${part.name}`);
    }
    default:
      throw new AcpUnsupportedContentError(part.type);
  }
}
function serializeAppendMessage(message, capabilities) {
  if (message.role !== "user") {
    throw new AcpUnsupportedContentError(
      message.role,
      "ACP session/prompt only accepts user messages from the composer."
    );
  }
  const parts = [
    ...message.content,
    ...(message.attachments ?? []).flatMap((attachment) => attachment.content ?? [])
  ];
  return parts.map((part) => serializePart(part, capabilities));
}
var AUTHENTICATION_STATUS_METHOD = "authentication/status";
var parseAuthenticationStatus = (value) => {
  if (!value || typeof value !== "object" || typeof value.type !== "string") {
    throw new TypeError("The ACP authentication/status extension returned an invalid response.");
  }
  return value;
};
var SdkAcpClientAdapter = class {
  /** Creates an SDK adapter for a host-provided ACP stream. */
  constructor(createStream, name = "react-acp") {
    this.createStream = createStream;
    this.name = name;
  }
  createStream;
  name;
  /** Opens the stream, installs client request handlers, and returns a connection facade. */
  async connect({ handlers, signal }) {
    let app = client({ name: this.name }).onNotification(methods.client.session.update, ({ params }) => handlers.sessionUpdate(params)).onRequest(
      methods.client.session.requestPermission,
      ({ params, signal: requestSignal }) => handlers.requestPermission(params, requestSignal)
    );
    if (handlers.readTextFile) {
      app = app.onRequest(
        methods.client.fs.readTextFile,
        ({ params, signal: requestSignal }) => handlers.readTextFile(params, requestSignal)
      );
    }
    if (handlers.writeTextFile) {
      app = app.onRequest(
        methods.client.fs.writeTextFile,
        ({ params, signal: requestSignal }) => handlers.writeTextFile(params, requestSignal)
      );
    }
    if (handlers.terminal) {
      const terminal = handlers.terminal;
      app = app.onRequest(
        methods.client.terminal.create,
        ({ params, signal: requestSignal }) => terminal.create(params, requestSignal)
      ).onRequest(
        methods.client.terminal.output,
        ({ params, signal: requestSignal }) => terminal.output(params, requestSignal)
      ).onRequest(
        methods.client.terminal.release,
        ({ params, signal: requestSignal }) => terminal.release(params, requestSignal)
      ).onRequest(
        methods.client.terminal.waitForExit,
        ({ params, signal: requestSignal }) => terminal.waitForExit(params, requestSignal)
      ).onRequest(
        methods.client.terminal.kill,
        ({ params, signal: requestSignal }) => terminal.kill(params, requestSignal)
      );
    }
    const stream = await this.createStream({ signal });
    const connection = app.connect(stream);
    const close = () => connection.close(signal.reason);
    if (signal.aborted) close();
    else signal.addEventListener("abort", close, { once: true });
    return createConnectionFacade(connection, () => signal.removeEventListener("abort", close));
  }
};
var createConnectionFacade = (connection, cleanup) => ({
  signal: connection.signal,
  initialize: (request) => connection.agent.request(methods.agent.initialize, request),
  authenticationStatus: async () => {
    try {
      const response = await connection.agent.request(AUTHENTICATION_STATUS_METHOD, {});
      return parseAuthenticationStatus(response);
    } catch (error) {
      if (error instanceof RequestError && error.code === -32601) return void 0;
      throw error;
    }
  },
  authenticate: async (methodId) => {
    await connection.agent.request(methods.agent.authenticate, { methodId });
  },
  logout: () => connection.agent.request(methods.agent.logout, {}),
  newSession: (request) => connection.agent.request(methods.agent.session.new, request),
  loadSession: (request) => connection.agent.request(methods.agent.session.load, request),
  listSessions: (request) => connection.agent.request(methods.agent.session.list, request),
  deleteSession: (sessionId) => connection.agent.request(methods.agent.session.delete, { sessionId }),
  resumeSession: (request) => connection.agent.request(methods.agent.session.resume, request),
  closeSession: async (sessionId) => {
    await connection.agent.request(methods.agent.session.close, { sessionId });
  },
  setSessionMode: async (request) => {
    await connection.agent.request(methods.agent.session.setMode, request);
  },
  setSessionConfigOption: (request) => connection.agent.request(methods.agent.session.setConfigOption, request),
  prompt: (request) => connection.agent.request(methods.agent.session.prompt, request),
  cancel: (sessionId) => connection.agent.notify(methods.agent.session.cancel, { sessionId }),
  close: (error) => {
    cleanup();
    connection.close(error);
  }
});

// src/version.ts
var REACT_ACP_VERSION = "0.1.9";

// src/core/controller.ts
var comparableContent = (content) => {
  const value = { ...content };
  Reflect.deleteProperty(value, "_meta");
  return value;
};
var coalesceText = (blocks) => {
  const result = [];
  for (const block of blocks) {
    const previous = result.at(-1);
    if (block.type === "text" && previous?.type === "text") {
      result[result.length - 1] = { ...previous, text: previous.text + block.text };
    } else {
      result.push(block);
    }
  }
  return result;
};
var equalNonTextContent = (left, right) => JSON.stringify(comparableContent(left)) === JSON.stringify(comparableContent(right));
var echoRelation = (prompt, notifications) => {
  const expected = coalesceText(prompt);
  const actual = coalesceText(
    notifications.map((notification) => {
      const update = notification.update;
      if (update.sessionUpdate !== "user_message_chunk") {
        throw new AcpError("ACP_INTERNAL", "Expected buffered user message chunks.");
      }
      return update.content;
    })
  );
  if (actual.length > expected.length) return "different";
  for (let index = 0; index < actual.length; index += 1) {
    const incoming = actual[index];
    const target = expected[index];
    if (!target || incoming.type !== target.type) return "different";
    if (incoming.type === "text" && target.type === "text") {
      const last = index === actual.length - 1;
      if (last ? !target.text.startsWith(incoming.text) : target.text !== incoming.text) {
        return "different";
      }
    } else if (!equalNonTextContent(incoming, target)) {
      return "different";
    }
  }
  if (actual.length !== expected.length) return "prefix";
  const lastActual = actual.at(-1);
  const lastExpected = expected.at(-1);
  if (lastActual?.type === "text" && lastExpected?.type === "text") {
    return lastActual.text === lastExpected.text ? "equal" : "prefix";
  }
  return "equal";
};
var AcpThreadController = class {
  /** Creates a controller and validates the configured workspace paths. */
  constructor(options) {
    this.options = options;
    validateWorkspace(options.workspace);
    if (options.preparedSessionId) {
      this.state = { ...this.state, preparedSessionId: options.preparedSessionId };
    }
  }
  options;
  state = createAcpThreadState();
  listeners = /* @__PURE__ */ new Set();
  connection;
  abortController;
  connectPromise;
  permissionWaiters = /* @__PURE__ */ new Map();
  attachedSessions = /* @__PURE__ */ new Set();
  attachmentPromises = /* @__PURE__ */ new Map();
  loadingSessions = /* @__PURE__ */ new Map();
  pendingOutbound = /* @__PURE__ */ new Map();
  prepareSessionPromise;
  connectionGeneration = 0;
  selectionGeneration = 0;
  settledActiveSessionId;
  disposed = false;
  /** Returns the current immutable thread-state snapshot. */
  getState = () => this.state;
  /** Subscribes to state changes and returns an unsubscribe function. */
  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  dispatch(event) {
    this.state = reduceAcpThreadState(this.state, event, this.options.extensions);
    for (const listener of this.listeners) listener();
  }
  sessionHasResidentState(sessionId) {
    const session = this.state.sessions[sessionId];
    if (!session) return false;
    return session.messages.length > 0 || Object.keys(session.tools).length > 0 || Object.keys(session.permissions).length > 0 || session.plan !== void 0 || session.commands.length > 0 || session.usage !== void 0 || session.turn > 0 || session.lastChunk !== void 0 || session.lastAssistantMessageId !== void 0 || Object.keys(session.latestNotifications).length > 0 || session.unhandledNotifications.length > 0 || session.error !== void 0;
  }
  compactInactiveSessions() {
    const activeSessionId = this.state.activeSessionId;
    for (const [sessionId, session] of Object.entries(this.state.sessions)) {
      if (sessionId === activeSessionId || sessionId === this.state.preparedSessionId || session.runState === "loading" || session.runState === "running" || session.runState === "cancelling" || this.loadingSessions.has(sessionId) || this.attachmentPromises.has(sessionId) || this.pendingOutbound.has(sessionId) || Object.values(session.permissions).some((permission) => permission.status === "pending")) {
        continue;
      }
      if (!this.attachedSessions.has(sessionId) && !this.sessionHasResidentState(sessionId)) {
        continue;
      }
      this.attachedSessions.delete(sessionId);
      this.dispatch({ type: "session.compacted", sessionId });
    }
  }
  reportError(error) {
    this.options.onError?.(error);
  }
  get adapter() {
    return this.options.connection.type === "adapter" ? this.options.connection.adapter : new SdkAcpClientAdapter(
      this.options.connection.createStream,
      this.options.clientInfo?.name ?? "react-acp"
    );
  }
  /** Opens and initializes the ACP connection; concurrent calls share one attempt. */
  async connect() {
    if (this.disposed) throw new AcpError("ACP_DISPOSED", "Controller disposed");
    if (this.connection && !this.connection.signal.aborted) return;
    if (this.connectPromise) {
      const pending = this.connectPromise;
      try {
        await pending;
      } catch {
      }
      if (!this.connection || this.connection.signal.aborted) return this.connect();
      return;
    }
    this.connectPromise = this.doConnect().finally(() => {
      this.connectPromise = void 0;
    });
    return this.connectPromise;
  }
  async doConnect() {
    this.abortController?.abort();
    const generation = ++this.connectionGeneration;
    const abortController = new AbortController();
    this.abortController = abortController;
    this.attachedSessions.clear();
    this.attachmentPromises.clear();
    this.loadingSessions.clear();
    this.dispatch({ type: "connection.status", status: "connecting" });
    try {
      const services = this.options.clientServices;
      const connection = await this.adapter.connect({
        signal: abortController.signal,
        handlers: {
          sessionUpdate: (notification) => this.handleSessionUpdate(generation, notification),
          requestPermission: (request, signal) => {
            if (generation !== this.connectionGeneration) {
              return { outcome: { outcome: "cancelled" } };
            }
            this.flushEchoBoundary(request.sessionId);
            return this.waitForPermission(request, signal);
          },
          ...services?.fileSystem?.readTextFile ? { readTextFile: services.fileSystem.readTextFile } : {},
          ...services?.fileSystem?.writeTextFile ? { writeTextFile: services.fileSystem.writeTextFile } : {},
          ...hasCompleteTerminalServices(services?.terminal) ? { terminal: services.terminal } : {}
        }
      });
      if (generation !== this.connectionGeneration) {
        connection.close();
        throw new AcpError("ACP_DISCONNECTED", "ACP connection was superseded.");
      }
      this.connection = connection;
      connection.signal.addEventListener(
        "abort",
        () => {
          if (!this.disposed && generation === this.connectionGeneration) {
            this.connection = void 0;
            this.attachedSessions.clear();
            this.dispatch({ type: "connection.status", status: "closed" });
          }
        },
        { once: true }
      );
      const response = await connection.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: buildClientCapabilities(services, this.options.clientCapabilities),
        clientInfo: this.options.clientInfo ?? {
          name: "react-acp",
          version: REACT_ACP_VERSION
        }
      });
      if (generation !== this.connectionGeneration || abortController.signal.aborted) {
        connection.close(abortController.signal.reason);
        throw new AcpError("ACP_DISCONNECTED", "ACP connection was aborted.");
      }
      if (response.protocolVersion !== PROTOCOL_VERSION) {
        throw new AcpError(
          "ACP_PROTOCOL_VERSION",
          `Unsupported ACP protocol version ${response.protocolVersion}`
        );
      }
      this.dispatch({ type: "connection.initialized", response });
      const authenticationRequired = await this.isAuthenticationRequired(connection, response);
      if (generation !== this.connectionGeneration || abortController.signal.aborted) {
        connection.close(abortController.signal.reason);
        throw new AcpError("ACP_DISCONNECTED", "ACP connection was aborted.");
      }
      this.dispatch({
        type: "connection.status",
        status: authenticationRequired ? "auth-required" : "ready"
      });
      if (!authenticationRequired) await this.afterAuthentication(generation);
    } catch (error) {
      if (generation !== this.connectionGeneration) throw error;
      if (abortController.signal.aborted) {
        this.dispatch({ type: "connection.status", status: "closed" });
      } else {
        this.dispatch({ type: "connection.status", status: "error", error });
        this.reportError(error);
      }
      throw error;
    }
  }
  /** Closes the current connection and starts a fresh initialization. */
  async reconnect() {
    this.disconnectTransport();
    await this.connect();
  }
  /** Authenticates with an advertised method and completes session setup. */
  async authenticate(methodId) {
    const generation = this.connectionGeneration;
    const connection = this.requireConnection();
    await connection.authenticate(methodId);
    if (generation !== this.connectionGeneration) return;
    this.dispatch({ type: "connection.status", status: "ready" });
    await this.afterAuthentication(generation);
  }
  /** Logs out when the agent advertises the ACP logout capability. */
  async logout() {
    if (!hasAgentCapability(this.state.capabilities, "logout")) {
      throw new AcpCapabilityError("logout");
    }
    await this.requireConnection().logout();
    this.dispatch({
      type: "connection.status",
      status: this.state.authMethods.length ? "auth-required" : "ready"
    });
  }
  async isAuthenticationRequired(connection, response) {
    if (!(response.authMethods?.length ?? 0)) return false;
    const authenticationStatus = await connection.authenticationStatus?.();
    if (!authenticationStatus) return false;
    return authenticationStatus.type === "unauthenticated";
  }
  async runAgentRequest(operation) {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof RequestError && error.code === -32e3) {
        this.dispatch({ type: "connection.status", status: "auth-required" });
      }
      throw error;
    }
  }
  async afterAuthentication(generation) {
    if (hasAgentCapability(this.state.capabilities, "list")) await this.refreshSessions();
    if (generation !== this.connectionGeneration) return;
    const activeSessionId = this.state.activeSessionId;
    if (!activeSessionId) return;
    try {
      await this.attachSession(activeSessionId, { force: true });
      this.settledActiveSessionId = activeSessionId;
      this.compactInactiveSessions();
    } catch (error) {
      if (this.state.preparedSessionId === activeSessionId) {
        this.discardPreparedSession(activeSessionId);
      }
      this.reportError(error);
    }
  }
  /** Loads every page of the agent's session list into local state. */
  async refreshSessions() {
    const generation = this.connectionGeneration;
    const connection = this.requireConnection();
    const sessions = [];
    let cursor;
    do {
      const response = await this.runAgentRequest(
        () => connection.listSessions(cursor ? { cursor } : {})
      );
      if (generation !== this.connectionGeneration) return;
      sessions.push(...response.sessions);
      cursor = response.nextCursor ?? void 0;
    } while (cursor);
    this.dispatch({ type: "sessions.listed", sessions });
    this.compactInactiveSessions();
  }
  /** Creates, attaches, and selects a new ACP session. */
  async createSession() {
    const token = ++this.selectionGeneration;
    const generation = this.connectionGeneration;
    const response = await this.runAgentRequest(
      () => this.requireConnection().newSession(
        buildSessionRequest(this.options.workspace, this.state.capabilities)
      )
    );
    if (generation !== this.connectionGeneration) {
      throw new AcpError("ACP_DISCONNECTED", "ACP connection changed while creating a session.");
    }
    this.attachedSessions.add(response.sessionId);
    this.dispatch({
      type: "session.attached",
      sessionId: response.sessionId,
      modes: response.modes,
      configOptions: response.configOptions,
      access: { mode: "read-write" }
    });
    if (token === this.selectionGeneration) {
      this.dispatch({ type: "session.selected", sessionId: response.sessionId });
      this.settledActiveSessionId = response.sessionId;
      this.options.onThreadIdChange?.(response.sessionId);
    }
    this.compactInactiveSessions();
    return response.sessionId;
  }
  /** Creates or restores a session without exposing it in visible thread lists. */
  async prepareSession() {
    if (this.prepareSessionPromise) return this.prepareSessionPromise;
    const pending = this.performPrepareSession().finally(() => {
      if (this.prepareSessionPromise === pending) this.prepareSessionPromise = void 0;
    });
    this.prepareSessionPromise = pending;
    return pending;
  }
  async performPrepareSession() {
    const preparedSessionId = this.state.preparedSessionId;
    if (preparedSessionId) {
      if (this.state.activeSessionId === preparedSessionId && this.attachedSessions.has(preparedSessionId)) {
        return preparedSessionId;
      }
      try {
        await this.selectSession(preparedSessionId, { notify: false });
        return preparedSessionId;
      } catch {
        this.discardPreparedSession(preparedSessionId);
      }
    } else if (this.state.activeSessionId) {
      return this.state.activeSessionId;
    }
    const token = ++this.selectionGeneration;
    const generation = this.connectionGeneration;
    const response = await this.runAgentRequest(
      () => this.requireConnection().newSession(
        buildSessionRequest(this.options.workspace, this.state.capabilities)
      )
    );
    if (generation !== this.connectionGeneration) {
      throw new AcpError("ACP_DISCONNECTED", "ACP connection changed while preparing a session.");
    }
    this.dispatch({ type: "session.preparing", sessionId: response.sessionId });
    this.attachedSessions.add(response.sessionId);
    this.dispatch({
      type: "session.attached",
      sessionId: response.sessionId,
      modes: response.modes,
      configOptions: response.configOptions,
      access: { mode: "read-write" }
    });
    if (token === this.selectionGeneration) {
      this.dispatch({ type: "session.selected", sessionId: response.sessionId });
      this.settledActiveSessionId = response.sessionId;
    }
    this.options.onPreparedSessionIdChange?.(response.sessionId);
    return response.sessionId;
  }
  commitPreparedSession(sessionId) {
    if (this.state.preparedSessionId !== sessionId) return;
    this.dispatch({ type: "session.committed", sessionId });
    this.settledActiveSessionId = sessionId;
    this.options.onPreparedSessionIdChange?.(void 0);
    this.options.onThreadIdChange?.(sessionId);
  }
  discardPreparedSession(sessionId) {
    this.attachedSessions.delete(sessionId);
    this.dispatch({ type: "session.prepared_cleared", sessionId });
    this.options.onPreparedSessionIdChange?.(void 0);
  }
  /** Selects a session; only the latest in-flight selection may become active. */
  async selectSession(sessionId, options = {}) {
    const notify = options.notify ?? true;
    if (!options.force && this.state.activeSessionId === sessionId && this.attachedSessions.has(sessionId)) {
      return;
    }
    const token = ++this.selectionGeneration;
    const fallbackSessionId = this.settledActiveSessionId;
    try {
      await this.attachSession(sessionId, options);
    } catch (error) {
      if (token === this.selectionGeneration) {
        this.dispatch({ type: "session.selected", sessionId: fallbackSessionId });
      }
      this.compactInactiveSessions();
      throw error;
    }
    if (token !== this.selectionGeneration) {
      this.compactInactiveSessions();
      return;
    }
    this.dispatch({ type: "session.selected", sessionId });
    this.settledActiveSessionId = sessionId;
    this.compactInactiveSessions();
    if (notify) this.options.onThreadIdChange?.(sessionId);
  }
  async attachSession(sessionId, options = {}) {
    if (!options.force && this.attachedSessions.has(sessionId)) return;
    const pending = this.attachmentPromises.get(sessionId);
    if (pending) return pending;
    const promise = this.performAttach(sessionId, options);
    this.attachmentPromises.set(sessionId, promise);
    try {
      await promise;
    } finally {
      if (this.attachmentPromises.get(sessionId) === promise) {
        this.attachmentPromises.delete(sessionId);
      }
    }
  }
  async performAttach(sessionId, options) {
    const generation = this.connectionGeneration;
    const connection = this.requireConnection();
    const snapshot = this.state.sessions[sessionId] ?? createAcpSessionState(sessionId);
    const base = buildSessionRequest(this.options.workspace, this.state.capabilities);
    const useResume = options.method === "resume" || !hasAgentCapability(this.state.capabilities, "load") && hasAgentCapability(this.state.capabilities, "resume");
    if (options.method === "resume" && !hasAgentCapability(this.state.capabilities, "resume")) {
      throw new AcpCapabilityError("session/resume");
    }
    if (!useResume && !hasAgentCapability(this.state.capabilities, "load")) {
      const error = new AcpCapabilityError(
        "session/load or session/resume",
        "This agent cannot reopen an existing ACP session."
      );
      this.dispatch({ type: "session.attach_failed", sessionId, error });
      throw error;
    }
    this.dispatch({ type: "session.loading", sessionId, clearHistory: !useResume });
    const replay = useResume ? void 0 : [];
    if (replay) this.loadingSessions.set(sessionId, replay);
    try {
      const response = await this.runAgentRequest(
        () => useResume ? connection.resumeSession({ sessionId, ...base }) : connection.loadSession({ sessionId, ...base })
      );
      if (generation !== this.connectionGeneration) {
        throw new AcpError("ACP_DISCONNECTED", "ACP connection changed while attaching a session.");
      }
      for (const notification of replay ?? []) {
        this.state = reduceAcpThreadState(
          this.state,
          { type: "session.update", notification },
          this.options.extensions
        );
      }
      if (replay) this.loadingSessions.delete(sessionId);
      this.attachedSessions.add(sessionId);
      this.dispatch({
        type: "session.attached",
        sessionId,
        info: snapshot.info,
        modes: response.modes,
        configOptions: response.configOptions,
        access: this.options.extensions?.sessionAccess?.(
          useResume ? { method: "resume", response } : { method: "load", response }
        ) ?? { mode: "read-write" }
      });
    } catch (error) {
      if (generation === this.connectionGeneration) {
        this.dispatch({ type: "session.restored", session: snapshot, error });
      }
      throw error;
    } finally {
      if (replay && this.loadingSessions.get(sessionId) === replay) {
        this.loadingSessions.delete(sessionId);
      }
    }
  }
  /** Permanently deletes a session when the agent advertises support. */
  async deleteSession(sessionId) {
    this.assertSessionWritable(sessionId);
    if (!hasAgentCapability(this.state.capabilities, "delete")) {
      throw new AcpCapabilityError("session/delete");
    }
    await this.runAgentRequest(() => this.requireConnection().deleteSession(sessionId));
    this.attachedSessions.delete(sessionId);
    this.dispatch({ type: "session.deleted", sessionId });
    if (this.settledActiveSessionId === sessionId) {
      ++this.selectionGeneration;
      this.settledActiveSessionId = void 0;
      this.options.onThreadIdChange?.(void 0);
    }
  }
  /** Explicitly resumes and selects a session. */
  async resumeSession(sessionId) {
    await this.selectSession(sessionId, { force: true, method: "resume" });
  }
  /** Forces session/load again so a read-only snapshot can reacquire write access. */
  async reloadSession(sessionId) {
    await this.selectSession(sessionId, { force: true, method: "auto" });
  }
  /** Closes a session without deleting its cached history. */
  async closeSession(sessionId) {
    if (!hasAgentCapability(this.state.capabilities, "close")) {
      throw new AcpCapabilityError("session/close");
    }
    await this.cancelPendingPermissions(sessionId);
    await this.runAgentRequest(() => this.requireConnection().closeSession(sessionId));
    this.attachedSessions.delete(sessionId);
    this.dispatch({ type: "session.closed", sessionId });
    if (this.state.activeSessionId === sessionId) {
      ++this.selectionGeneration;
      this.dispatch({ type: "session.selected", sessionId: void 0 });
      this.settledActiveSessionId = void 0;
      this.options.onThreadIdChange?.(void 0);
    }
  }
  /** Sends one serialized ACP prompt turn and records its lifecycle. */
  async prompt(sessionId, prompt) {
    this.assertSessionWritable(sessionId);
    if (!this.attachedSessions.has(sessionId)) {
      throw new AcpError(
        "ACP_SESSION_NOT_ATTACHED",
        `ACP session '${sessionId}' is not attached to the current connection.`
      );
    }
    const session = this.state.sessions[sessionId];
    if (session?.runState === "running" || session?.runState === "cancelling") {
      throw new AcpError("ACP_TURN_RUNNING", "An ACP prompt turn is already running.");
    }
    this.dispatch({ type: "session.prompt_started", sessionId });
    try {
      const response = await this.runAgentRequest(
        () => this.requireConnection().prompt({ sessionId, prompt })
      );
      this.dispatch({ type: "session.prompt_stopped", sessionId, response });
      this.compactInactiveSessions();
      return response;
    } catch (error) {
      this.dispatch({ type: "session.turn_failed", sessionId, error });
      this.compactInactiveSessions();
      this.reportError(error);
      throw error;
    }
  }
  /** Serializes and sends an assistant-ui user message with optimistic projection. */
  async sendMessage(message) {
    const sessionId = this.state.activeSessionId ?? await this.prepareSession();
    this.assertSessionWritable(sessionId);
    const prompt = serializeAppendMessage(message, this.state.capabilities);
    this.commitPreparedSession(sessionId);
    const sentAt = Date.now();
    const messageId = `local:${sessionId}:${sentAt}:${Math.random().toString(36).slice(2)}`;
    this.dispatch({
      type: "message.optimistic",
      sessionId,
      message: {
        id: messageId,
        role: "user",
        createdAt: sentAt,
        sentAt,
        optimistic: true,
        pieces: prompt.map((content) => ({ type: "content", content })),
        rawNotifications: []
      }
    });
    this.pendingOutbound.set(sessionId, {
      messageId,
      prompt,
      buffered: [],
      echoDisabled: false,
      confirmed: false
    });
    try {
      await this.prompt(sessionId, prompt);
      this.finishPendingOutbound(sessionId, true);
    } catch (error) {
      this.finishPendingOutbound(sessionId, false);
      this.dispatch({ type: "message.optimistic_failed", sessionId, messageId, error });
      throw error;
    }
  }
  handleSessionUpdate(generation, notification) {
    if (generation !== this.connectionGeneration) return;
    const sessionId = notification.sessionId;
    const replay = this.loadingSessions.get(sessionId);
    if (replay) {
      replay.push(notification);
      return;
    }
    if (!this.attachedSessions.has(sessionId) && !this.loadingSessions.has(sessionId) && !this.attachmentPromises.has(sessionId) && !this.pendingOutbound.has(sessionId)) {
      return;
    }
    const update = notification.update;
    const pending = this.pendingOutbound.get(sessionId);
    if (pending && !this.loadingSessions.has(sessionId) && update.sessionUpdate === "user_message_chunk" && !pending.echoDisabled) {
      const incomingId = update.messageId ?? void 0;
      if (pending.protocolMessageId && incomingId && pending.protocolMessageId !== incomingId) {
        this.flushBufferedOutbound(sessionId);
        pending.echoDisabled = true;
        this.dispatch({ type: "session.update", notification });
        return;
      }
      pending.protocolMessageId ??= incomingId;
      pending.buffered.push(notification);
      const relation = echoRelation(pending.prompt, pending.buffered);
      if (relation === "equal") {
        this.dispatch({
          type: "message.optimistic_confirmed",
          sessionId,
          messageId: pending.messageId,
          protocolMessageId: pending.protocolMessageId,
          notifications: pending.buffered
        });
        pending.buffered = [];
        pending.confirmed = true;
        pending.echoDisabled = true;
      } else if (relation === "different") {
        this.flushBufferedOutbound(sessionId);
        pending.echoDisabled = true;
      }
      return;
    }
    if (pending && update.sessionUpdate !== "user_message_chunk") {
      this.flushEchoBoundary(sessionId);
    }
    this.dispatch({ type: "session.update", notification });
  }
  flushEchoBoundary(sessionId) {
    const pending = this.pendingOutbound.get(sessionId);
    if (!pending?.buffered.length) return;
    this.flushBufferedOutbound(sessionId);
    pending.echoDisabled = true;
  }
  flushBufferedOutbound(sessionId) {
    const pending = this.pendingOutbound.get(sessionId);
    if (!pending) return;
    for (const notification of pending.buffered) {
      this.dispatch({ type: "session.update", notification });
    }
    pending.buffered = [];
  }
  finishPendingOutbound(sessionId, succeeded) {
    const pending = this.pendingOutbound.get(sessionId);
    if (!pending) return;
    this.flushBufferedOutbound(sessionId);
    if (succeeded && !pending.confirmed) {
      this.dispatch({
        type: "message.optimistic_confirmed",
        sessionId,
        messageId: pending.messageId
      });
    }
    this.pendingOutbound.delete(sessionId);
    this.compactInactiveSessions();
  }
  /** Cancels pending permissions and the active prompt turn for a session. */
  async cancel(sessionId) {
    this.dispatch({ type: "session.cancel_started", sessionId });
    await this.cancelPendingPermissions(sessionId);
    await this.requireConnection().cancel(sessionId);
  }
  async cancelPendingPermissions(sessionId) {
    for (const [toolCallId, permission] of Object.entries(
      this.state.sessions[sessionId]?.permissions ?? {}
    )) {
      if (permission.status === "pending") await this.replyToPermission(sessionId, toolCallId);
    }
  }
  /** Changes a session mode when modes were advertised by the agent. */
  async setMode(sessionId, modeId) {
    this.assertSessionWritable(sessionId);
    if (!this.state.sessions[sessionId]?.modes) {
      throw new AcpCapabilityError("session/set_mode");
    }
    await this.runAgentRequest(
      () => this.requireConnection().setSessionMode({ sessionId, modeId })
    );
  }
  /** Changes an advertised session configuration option. */
  async setConfigOption(sessionId, configId, value) {
    this.assertSessionWritable(sessionId);
    if (!this.state.sessions[sessionId]?.configOptions.some((option) => option.id === configId)) {
      throw new AcpCapabilityError("session/set_config_option");
    }
    const response = await this.runAgentRequest(
      () => this.requireConnection().setSessionConfigOption({
        sessionId,
        configId,
        value
      })
    );
    this.dispatch({
      type: "session.config_options",
      sessionId,
      configOptions: response.configOptions
    });
  }
  assertSessionWritable(sessionId) {
    const access = this.state.sessions[sessionId]?.access;
    if (access?.mode !== "read-only") return;
    throw new AcpError(
      "ACP_SESSION_READ_ONLY",
      access.reason ? `ACP session '${sessionId}' is read-only: ${access.reason}.` : `ACP session '${sessionId}' is read-only.`
    );
  }
  waitForPermission(request, signal) {
    this.dispatch({ type: "permission.requested", request });
    return new Promise((resolve, reject) => {
      const key = `${request.sessionId}:${request.toolCall.toolCallId}`;
      const abort = () => {
        const response = { outcome: { outcome: "cancelled" } };
        this.permissionWaiters.delete(key);
        this.dispatch({
          type: "permission.resolved",
          sessionId: request.sessionId,
          toolCallId: request.toolCall.toolCallId,
          response
        });
        this.compactInactiveSessions();
        signal.removeEventListener("abort", abort);
        resolve(response);
      };
      this.permissionWaiters.set(key, {
        resolve: (response) => {
          signal.removeEventListener("abort", abort);
          resolve(response);
        },
        reject: (error) => {
          signal.removeEventListener("abort", abort);
          reject(toError(error));
        }
      });
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    });
  }
  /** Resolves a pending permission, or cancels it when optionId is omitted. */
  async replyToPermission(sessionId, toolCallId, optionId) {
    const key = `${sessionId}:${toolCallId}`;
    const waiter = this.permissionWaiters.get(key);
    if (!waiter) return;
    const response = optionId ? { outcome: { outcome: "selected", optionId } } : { outcome: { outcome: "cancelled" } };
    this.permissionWaiters.delete(key);
    this.dispatch({ type: "permission.resolved", sessionId, toolCallId, response });
    waiter.resolve(response);
    this.compactInactiveSessions();
  }
  /** Permanently disposes the controller and rejects pending permission requests. */
  dispose() {
    this.disposed = true;
    this.disconnectTransport(new AcpError("ACP_DISPOSED", "Controller disposed"));
    this.listeners.clear();
  }
  /** Disconnects the current transport while allowing a later reconnect. */
  disconnect() {
    this.disconnectTransport(new AcpError("ACP_DISCONNECTED", "ACP disconnected"));
  }
  disconnectTransport(reason) {
    ++this.connectionGeneration;
    this.abortController?.abort(reason);
    this.connection?.close(reason);
    this.connection = void 0;
    this.attachedSessions.clear();
    this.attachmentPromises.clear();
    this.loadingSessions.clear();
    for (const waiter of this.permissionWaiters.values()) waiter.reject(reason);
    this.permissionWaiters.clear();
  }
  requireConnection() {
    if (!this.connection || this.connection.signal.aborted) {
      throw new AcpError("ACP_NOT_CONNECTED", "ACP is not connected.");
    }
    return this.connection;
  }
};

export { AcpCapabilityError, AcpError, AcpInvalidWorkspaceError, AcpProjectionCache, AcpThreadController, AcpUnsupportedContentError, SdkAcpClientAdapter, buildClientCapabilities, buildSessionRequest, createAcpSessionState, createAcpThreadState, hasAgentCapability, hasCompleteTerminalServices, projectAcpSessionMessages, projectAcpSessionRepository, projectAcpThreadMessages, projectAcpThreadRepository, reduceAcpThreadState, serializeAppendMessage, validateWorkspace };
//# sourceMappingURL=chunk-ADQ3OILN.js.map
//# sourceMappingURL=chunk-ADQ3OILN.js.map