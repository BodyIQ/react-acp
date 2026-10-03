import { AssistantRuntime } from '@assistant-ui/react';
import { A as AcpRuntimeOptions } from './types-BEJXgqrE.js';
export { a as AcpAdapterConnectOptions, b as AcpAuthHookState, c as AcpAuthenticationStatus, d as AcpClientAdapter, e as AcpClientConnection, f as AcpClientHandlers, g as AcpClientServices, h as AcpConnectionHookState, i as AcpConnectionSource, j as AcpConnectionStatus, k as AcpFileSystemServices, l as AcpMessagePiece, m as AcpMessageRecord, n as AcpMessageStatePatch, o as AcpMessageStatus, p as AcpPermissionRecord, q as AcpPermissionsHookState, r as AcpProjectedMessage, s as AcpRuntime, t as AcpRuntimeExtensionAdapter, u as AcpRuntimeExtras, v as AcpSessionAccess, w as AcpSessionAccessContext, x as AcpSessionRunState, y as AcpSessionState, z as AcpStateEvent, B as AcpStreamFactory, C as AcpTerminalServices, D as AcpThreadState, E as AcpToolCallRecord, F as AcpToolDisplay, G as AcpToolDisplayUpdate, H as AcpWorkspace, M as MaybePromise } from './types-BEJXgqrE.js';
export { A as AcpAuthMethods, a as AcpCommandMenu, b as AcpConfigOptions, c as AcpDataPart, d as AcpDiff, e as AcpModeSelect, f as AcpPermissionList, g as AcpPlan, h as AcpResource, i as AcpTerminal, j as AcpToolArtifact, k as AcpUnsupported, l as AcpUsage, u as useAcpAuth, m as useAcpCommands, n as useAcpConfigOptions, o as useAcpConnection, p as useAcpModes, q as useAcpPermissions, r as useAcpPlan, s as useAcpRuntimeExtras, t as useAcpSession, v as useAcpThreadState, w as useAcpUsage } from './index-Bm9Oe-Pf.js';
import '@agentclientprotocol/sdk';
import 'react';

/**
 * Creates an assistant-ui runtime backed by an ACP v1 connection.
 *
 * The hook connects on mount, projects ACP sessions as assistant-ui threads,
 * and disconnects on unmount. The ACP session remains the authoritative source
 * for messages, tools, permissions, plans, modes, configuration, and usage.
 *
 * @param options Connection, workspace, client-service, and assistant-ui options.
 * @returns An assistant-ui runtime suitable for `AssistantRuntimeProvider`.
 * @throws {AcpError} When the workspace or ACP connection is invalid.
 */
declare function useAcpRuntime(options: AcpRuntimeOptions): AssistantRuntime;

export { AcpRuntimeOptions, useAcpRuntime };
