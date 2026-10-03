import { ComponentPropsWithoutRef, ReactElement, ReactNode } from 'react';
import { y as AcpSessionState, b as AcpAuthHookState, h as AcpConnectionHookState, q as AcpPermissionsHookState, u as AcpRuntimeExtras, D as AcpThreadState } from './types-BEJXgqrE.js';

/** Returns the ACP-specific commands and state attached to the current runtime. */
declare const useAcpRuntimeExtras: () => AcpRuntimeExtras;
/** Returns connection status, advertised capabilities, errors, and reconnect. */
declare const useAcpConnection: () => AcpConnectionHookState;
/** Returns the active ACP session, or `undefined` before one is selected. */
declare const useAcpSession: () => AcpSessionState | undefined;
/** Returns the complete ACP thread state. */
declare function useAcpThreadState(): AcpThreadState;
/** Selects a derived value from the complete ACP thread state. */
declare function useAcpThreadState<T>(selector: (state: AcpThreadState) => T): T;
/** Returns advertised authentication methods and authentication actions. */
declare const useAcpAuth: () => AcpAuthHookState;
/** Returns pending tool permissions for the active session and a reply action. */
declare const useAcpPermissions: () => AcpPermissionsHookState;
/** Returns the latest plan update for the active session. */
declare const useAcpPlan: () => AcpSessionState["plan"];
/** Returns the commands currently advertised by the active ACP session. */
declare const useAcpCommands: () => AcpSessionState["commands"];
/** Returns the available and selected modes for the active session. */
declare const useAcpModes: () => AcpSessionState["modes"];
/** Returns the configuration options currently advertised by the active session. */
declare const useAcpConfigOptions: () => AcpSessionState["configOptions"];
/** Returns the latest ACP usage update for the active session. */
declare const useAcpUsage: () => AcpSessionState["usage"];

type DivProps = ComponentPropsWithoutRef<"div">;
/**
 * Renders advertised authentication methods as buttons.
 * Returns `null` when authentication is not required.
 */
declare function AcpAuthMethods({ children, ...props }: DivProps): ReactElement | null;
/**
 * Renders pending ACP tool-permission options for the active session.
 * Returns `null` when no permission is pending.
 */
declare function AcpPermissionList({ children, ...props }: DivProps): ReactElement | null;
/** Renders the latest ACP plan as an ordered list, or `null` when absent. */
declare function AcpPlan({ children, ...props }: DivProps): ReactElement | null;
/** Renders the active session's advertised modes as an unstyled select. */
declare function AcpModeSelect(props: Omit<ComponentPropsWithoutRef<"select">, "value" | "onChange">): ReactElement | null;
/** Renders advertised boolean and select configuration options for the session. */
declare function AcpConfigOptions({ children, ...props }: DivProps): ReactElement | null;
/** Renders advertised slash commands and reports the selected prompt text. */
declare function AcpCommandMenu({ onSelect, children, ...props }: DivProps & {
    onSelect?: (prompt: string) => void;
}): ReactElement | null;
/** Renders the latest ACP usage update with an optional custom render function. */
declare function AcpUsage({ render, ...props }: DivProps & {
    render?: (usage: NonNullable<ReturnType<typeof useAcpUsage>>) => ReactNode;
}): ReactElement | null;
/** Renders the ACP metadata retained on an assistant-ui tool-call artifact. */
declare function AcpToolArtifact({ artifact, ...props }: DivProps & {
    artifact: unknown;
}): ReactElement | null;
/** Renders an ACP data part as readable JSON with a stable data attribute. */
declare function AcpDataPart({ name, data, ...props }: DivProps & {
    name: string;
    data: unknown;
}): ReactElement;
/** Renders a protocol or tool diff value without applying visual styling. */
declare function AcpDiff({ diff, ...props }: DivProps & {
    diff: unknown;
}): ReactElement;
/** Renders retained ACP terminal data as readable JSON. */
declare function AcpTerminal({ terminal, ...props }: DivProps & {
    terminal: unknown;
}): ReactElement;
/** Renders an ACP resource link or retained resource value. */
declare function AcpResource({ resource, ...props }: DivProps & {
    resource: unknown;
}): ReactElement;
/** Renders a forward-compatible ACP value not interpreted by this package. */
declare function AcpUnsupported({ value, ...props }: DivProps & {
    value: unknown;
}): ReactElement;

export { AcpAuthMethods as A, AcpCommandMenu as a, AcpConfigOptions as b, AcpDataPart as c, AcpDiff as d, AcpModeSelect as e, AcpPermissionList as f, AcpPlan as g, AcpResource as h, AcpTerminal as i, AcpToolArtifact as j, AcpUnsupported as k, AcpUsage as l, useAcpCommands as m, useAcpConfigOptions as n, useAcpConnection as o, useAcpModes as p, useAcpPermissions as q, useAcpPlan as r, useAcpRuntimeExtras as s, useAcpSession as t, useAcpAuth as u, useAcpThreadState as v, useAcpUsage as w };
