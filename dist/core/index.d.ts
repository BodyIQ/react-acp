import { y as AcpSessionState, D as AcpThreadState, z as AcpStateEvent, t as AcpRuntimeExtensionAdapter, m as AcpMessageRecord, r as AcpProjectedMessage, g as AcpClientServices, H as AcpWorkspace, C as AcpTerminalServices, d as AcpClientAdapter, B as AcpStreamFactory, a as AcpAdapterConnectOptions, e as AcpClientConnection, A as AcpRuntimeOptions } from '../types-DiexR_zv.js';
export { b as AcpAuthHookState, c as AcpAuthenticationStatus, f as AcpClientHandlers, h as AcpConnectionHookState, i as AcpConnectionSource, j as AcpConnectionStatus, k as AcpFileSystemServices, l as AcpMessagePiece, n as AcpMessageStatePatch, o as AcpMessageStatus, p as AcpPermissionRecord, q as AcpPermissionsHookState, s as AcpRuntime, u as AcpRuntimeExtras, v as AcpSessionAccess, w as AcpSessionAccessContext, x as AcpSessionRunState, E as AcpToolCallRecord, F as AcpToolDisplay, G as AcpToolDisplayUpdate, M as MaybePromise } from '../types-DiexR_zv.js';
import { AgentCapabilities, ClientCapabilities, McpServer, ContentBlock, PromptResponse } from '@agentclientprotocol/sdk';
import { ExportedMessageRepository, AppendMessage } from '@assistant-ui/react';

/** Base error for ACP runtime, validation, serialization, and lifecycle failures. */
declare class AcpError extends Error {
    /** Stable machine-readable error code. */
    readonly code: string;
    /** Original failure, when the error wraps another exception. */
    readonly cause?: unknown;
    /** Creates an ACP error with a stable code and optional original cause. */
    constructor(code: string, message: string, cause?: unknown);
}
/** Indicates that an operation is unavailable under advertised ACP capabilities. */
declare class AcpCapabilityError extends AcpError {
    /** Creates an error for an operation not advertised by the connected agent. */
    constructor(capability: string, message?: string);
}
/** Indicates that assistant-ui content cannot be serialized to ACP. */
declare class AcpUnsupportedContentError extends AcpError {
    /** The unsupported assistant-ui content kind. */
    readonly contentType: string;
    /** Creates an error for an assistant-ui content kind that ACP cannot accept. */
    constructor(contentType: string, message?: string);
}
/** Indicates that an ACP workspace path is not absolute. */
declare class AcpInvalidWorkspaceError extends AcpError {
    /** Creates an error for a relative workspace path. */
    constructor(path: string);
}

/** Creates the empty, disconnected ACP thread repository. */
declare const createAcpThreadState: () => AcpThreadState;
/** Creates empty protocol-authoritative state for an ACP session ID. */
declare const createAcpSessionState: (sessionId: string) => AcpSessionState;
/** Applies one connection, session, message, tool, or permission event. */
declare function reduceAcpThreadState(state: AcpThreadState, event: AcpStateEvent, extensions?: AcpRuntimeExtensionAdapter): AcpThreadState;
/** Tests whether an optional stable ACP session or auth capability is advertised. */
declare const hasAgentCapability: (capabilities: AgentCapabilities | undefined, capability: "load" | "list" | "delete" | "resume" | "close" | "logout") => boolean;

type ProjectionExtensions = Pick<AcpRuntimeExtensionAdapter, "messagePhase"> | undefined;
/** Reuses projections for unchanged message groups within one active session. */
declare class AcpProjectionCache {
    private entries;
    private extensions;
    begin(extensions: ProjectionExtensions): void;
    project(session: AcpSessionState, messages: readonly [AcpMessageRecord, ...AcpMessageRecord[]], extensions: ProjectionExtensions): AcpProjectedMessage;
    retain(keys: ReadonlySet<string>): void;
}
/** Projects one already-resolved ACP session into assistant-ui messages. */
declare function projectAcpSessionMessages(session: AcpSessionState | undefined, extensions?: ProjectionExtensions, cache?: AcpProjectionCache): AcpProjectedMessage[];
/** Projects one already-resolved ACP session into an exported repository. */
declare function projectAcpSessionRepository(session: AcpSessionState | undefined, extensions?: ProjectionExtensions, cache?: AcpProjectionCache): ExportedMessageRepository;
/** Projects one ACP session into assistant-ui thread messages. */
declare function projectAcpThreadMessages(state: AcpThreadState, sessionId?: string | undefined, extensions?: Pick<AcpRuntimeExtensionAdapter, "messagePhase">): AcpProjectedMessage[];
/** Projects all ACP sessions into an assistant-ui exported message repository. */
declare function projectAcpThreadRepository(state: AcpThreadState, sessionId?: string | undefined, extensions?: Pick<AcpRuntimeExtensionAdapter, "messagePhase">): ExportedMessageRepository;

/** Returns whether every terminal operation required by ACP is implemented. */
declare const hasCompleteTerminalServices: (terminal: AcpTerminalServices | undefined) => terminal is AcpTerminalServices;
/**
 * Validates that the workspace and additional directories use absolute paths.
 * @throws {AcpInvalidWorkspaceError} When any path is relative.
 */
declare function validateWorkspace(workspace: AcpWorkspace): void;
/** Builds advertised ACP client capabilities from host services and overrides. */
declare function buildClientCapabilities(services: AcpClientServices | undefined, additions: ClientCapabilities | undefined): ClientCapabilities;
/** Builds the workspace portion of ACP new, load, and resume requests. */
declare function buildSessionRequest(workspace: AcpWorkspace, capabilities?: AgentCapabilities): {
    cwd: string;
    mcpServers: McpServer[];
    additionalDirectories?: string[];
};
/**
 * Serializes one assistant-ui user append into ACP prompt content blocks.
 * @throws {AcpUnsupportedContentError} When role, content, or capability is unsupported.
 */
declare function serializeAppendMessage(message: AppendMessage, capabilities: AgentCapabilities | undefined): ContentBlock[];

/** ACP client adapter implemented with the official TypeScript SDK and a stream factory. */
declare class SdkAcpClientAdapter implements AcpClientAdapter {
    private readonly createStream;
    private readonly name;
    /** Creates an SDK adapter for a host-provided ACP stream. */
    constructor(createStream: AcpStreamFactory, name?: string);
    /** Opens the stream, installs client request handlers, and returns a connection facade. */
    connect({ handlers, signal }: AcpAdapterConnectOptions): Promise<AcpClientConnection>;
}

type SelectSessionOptions = {
    notify?: boolean;
    force?: boolean;
    method?: "auto" | "resume";
};
/** Owns one ACP connection and the protocol-authoritative session repository. */
declare class AcpThreadController {
    private readonly options;
    private state;
    private readonly listeners;
    private connection?;
    private abortController?;
    private connectPromise?;
    private readonly permissionWaiters;
    private readonly attachedSessions;
    private readonly attachmentPromises;
    private readonly loadingSessions;
    private readonly pendingOutbound;
    private prepareSessionPromise?;
    private connectionGeneration;
    private selectionGeneration;
    private settledActiveSessionId?;
    private disposed;
    /** Creates a controller and validates the configured workspace paths. */
    constructor(options: AcpRuntimeOptions);
    /** Returns the current immutable thread-state snapshot. */
    getState: () => AcpThreadState;
    /** Subscribes to state changes and returns an unsubscribe function. */
    subscribe: (listener: () => void) => (() => void);
    private dispatch;
    private sessionHasResidentState;
    private compactInactiveSessions;
    private reportError;
    private get adapter();
    /** Opens and initializes the ACP connection; concurrent calls share one attempt. */
    connect(): Promise<void>;
    private doConnect;
    /** Closes the current connection and starts a fresh initialization. */
    reconnect(): Promise<void>;
    /** Authenticates with an advertised method and completes session setup. */
    authenticate(methodId: string): Promise<void>;
    /** Logs out when the agent advertises the ACP logout capability. */
    logout(): Promise<void>;
    private isAuthenticationRequired;
    private runAgentRequest;
    private afterAuthentication;
    /** Loads every page of the agent's session list into local state. */
    refreshSessions(): Promise<void>;
    /** Creates, attaches, and selects a new ACP session. */
    createSession(): Promise<string>;
    /** Creates or restores a session without exposing it in visible thread lists. */
    prepareSession(): Promise<string>;
    private performPrepareSession;
    private commitPreparedSession;
    private discardPreparedSession;
    /** Selects a session; only the latest in-flight selection may become active. */
    selectSession(sessionId: string, options?: SelectSessionOptions): Promise<void>;
    private attachSession;
    private performAttach;
    /** Permanently deletes a session when the agent advertises support. */
    deleteSession(sessionId: string): Promise<void>;
    /** Explicitly resumes and selects a session. */
    resumeSession(sessionId: string): Promise<void>;
    /** Forces session/load again so a read-only snapshot can reacquire write access. */
    reloadSession(sessionId: string): Promise<void>;
    /** Closes a session without deleting its cached history. */
    closeSession(sessionId: string): Promise<void>;
    /** Sends one serialized ACP prompt turn and records its lifecycle. */
    prompt(sessionId: string, prompt: ContentBlock[]): Promise<PromptResponse>;
    /** Serializes and sends an assistant-ui user message with optimistic projection. */
    sendMessage(message: AppendMessage): Promise<void>;
    private handleSessionUpdate;
    private flushEchoBoundary;
    private flushBufferedOutbound;
    private finishPendingOutbound;
    /** Cancels pending permissions and the active prompt turn for a session. */
    cancel(sessionId: string): Promise<void>;
    private cancelPendingPermissions;
    /** Changes a session mode when modes were advertised by the agent. */
    setMode(sessionId: string, modeId: string): Promise<void>;
    /** Changes an advertised session configuration option. */
    setConfigOption(sessionId: string, configId: string, value: string | boolean): Promise<void>;
    private assertSessionWritable;
    private waitForPermission;
    /** Resolves a pending permission, or cancels it when optionId is omitted. */
    replyToPermission(sessionId: string, toolCallId: string, optionId?: string): Promise<void>;
    /** Permanently disposes the controller and rejects pending permission requests. */
    dispose(): void;
    /** Disconnects the current transport while allowing a later reconnect. */
    disconnect(): void;
    private disconnectTransport;
    private requireConnection;
}

export { AcpAdapterConnectOptions, AcpCapabilityError, AcpClientAdapter, AcpClientConnection, AcpClientServices, AcpError, AcpInvalidWorkspaceError, AcpMessageRecord, AcpProjectedMessage, AcpProjectionCache, AcpRuntimeExtensionAdapter, AcpRuntimeOptions, AcpSessionState, AcpStateEvent, AcpStreamFactory, AcpTerminalServices, AcpThreadController, AcpThreadState, AcpUnsupportedContentError, AcpWorkspace, SdkAcpClientAdapter, buildClientCapabilities, buildSessionRequest, createAcpSessionState, createAcpThreadState, hasAgentCapability, hasCompleteTerminalServices, projectAcpSessionMessages, projectAcpSessionRepository, projectAcpThreadMessages, projectAcpThreadRepository, reduceAcpThreadState, serializeAppendMessage, validateWorkspace };
