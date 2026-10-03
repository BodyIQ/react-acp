import { createAcpThreadState } from './chunk-ADQ3OILN.js';
import { useMemo } from 'react';
import { createRuntimeExtras } from '@assistant-ui/core/react';
import { jsxs, jsx } from 'react/jsx-runtime';

var acpExtras = createRuntimeExtras("useAcpRuntime");

// src/hooks.ts
var EMPTY_STATE = createAcpThreadState();
var useAcpRuntimeExtras = () => acpExtras.use();
var useAcpConnection = () => {
  const extras = acpExtras.use((value) => value, void 0);
  return useMemo(
    () => ({
      status: extras?.state.connectionStatus ?? "idle",
      error: extras?.state.connectionError,
      capabilities: extras?.state.capabilities,
      reconnect: extras?.reconnect ?? (async () => {
      })
    }),
    [extras]
  );
};
var useAcpSession = () => acpExtras.use((extras) => extras.session, void 0);
function useAcpThreadState(selector) {
  return acpExtras.use(
    (extras) => selector ? selector(extras.state) : extras.state,
    selector ? selector(EMPTY_STATE) : EMPTY_STATE
  );
}
var useAcpAuth = () => {
  const extras = acpExtras.use((value) => value, void 0);
  return useMemo(
    () => ({
      methods: extras?.state.authMethods ?? [],
      required: extras?.state.connectionStatus === "auth-required",
      authenticate: extras?.authenticate ?? (async () => {
        throw new Error("ACP runtime is not ready");
      }),
      logout: extras?.logout ?? (async () => {
      })
    }),
    [extras]
  );
};
var useAcpPermissions = () => {
  const extras = acpExtras.use((value) => value, void 0);
  const pending = extras?.session ? Object.values(extras.session.permissions).filter(
    (permission) => permission.status === "pending"
  ) : [];
  return {
    pending,
    reply: extras?.replyToPermission ?? (async () => {
      throw new Error("ACP runtime is not ready");
    })
  };
};
var useAcpPlan = () => useAcpSession()?.plan;
var useAcpCommands = () => useAcpSession()?.commands ?? [];
var useAcpModes = () => useAcpSession()?.modes;
var useAcpConfigOptions = () => useAcpSession()?.configOptions ?? [];
var useAcpUsage = () => useAcpSession()?.usage;
function AcpAuthMethods({ children, ...props }) {
  const auth = useAcpAuth();
  if (!auth.required) return null;
  return /* @__PURE__ */ jsxs("div", { ...props, children: [
    children,
    auth.methods.map((method) => /* @__PURE__ */ jsx("button", { type: "button", onClick: () => void auth.authenticate(method.id), children: method.name }, method.id))
  ] });
}
function AcpPermissionList({ children, ...props }) {
  const { pending, reply } = useAcpPermissions();
  if (!pending.length) return null;
  return /* @__PURE__ */ jsxs("div", { ...props, children: [
    children,
    pending.map(({ request }) => /* @__PURE__ */ jsxs("fieldset", { children: [
      /* @__PURE__ */ jsx("legend", { children: request.toolCall.title ?? request.toolCall.toolCallId }),
      request.options.map((option) => /* @__PURE__ */ jsx(
        "button",
        {
          type: "button",
          onClick: () => void reply(request.toolCall.toolCallId, option.optionId),
          children: option.name
        },
        option.optionId
      )),
      /* @__PURE__ */ jsx("button", { type: "button", onClick: () => void reply(request.toolCall.toolCallId), children: "Cancel" })
    ] }, request.toolCall.toolCallId))
  ] });
}
function AcpPlan({ children, ...props }) {
  const plan = useAcpPlan();
  if (!plan) return null;
  return /* @__PURE__ */ jsxs("div", { ...props, children: [
    children,
    /* @__PURE__ */ jsx("ol", { children: plan.entries.map((entry, index) => /* @__PURE__ */ jsx(
      "li",
      {
        "data-status": entry.status,
        "data-priority": entry.priority,
        children: entry.content
      },
      `${index}:${entry.content}`
    )) })
  ] });
}
function AcpModeSelect(props) {
  const modes = useAcpModes();
  const extras = useAcpRuntimeExtras();
  const readOnly = extras.session?.access.mode === "read-only";
  if (!modes) return null;
  return /* @__PURE__ */ jsx(
    "select",
    {
      ...props,
      disabled: props.disabled || readOnly,
      value: modes.currentModeId,
      onChange: (event) => void extras.setMode(event.currentTarget.value),
      children: modes.availableModes.map((mode) => /* @__PURE__ */ jsx("option", { value: mode.id, title: mode.description ?? void 0, children: mode.name }, mode.id))
    }
  );
}
function AcpConfigOptions({ children, ...props }) {
  const options = useAcpConfigOptions();
  const extras = useAcpRuntimeExtras();
  const readOnly = extras.session?.access.mode === "read-only";
  if (!options.length) return null;
  return /* @__PURE__ */ jsxs("div", { ...props, children: [
    children,
    options.map((option) => /* @__PURE__ */ jsxs("label", { title: option.description ?? void 0, children: [
      /* @__PURE__ */ jsx("span", { children: option.name }),
      option.type === "boolean" ? /* @__PURE__ */ jsx(
        "input",
        {
          type: "checkbox",
          disabled: readOnly,
          checked: option.currentValue,
          onChange: (event) => void extras.setConfigOption(option.id, event.currentTarget.checked)
        }
      ) : /* @__PURE__ */ jsx(
        "select",
        {
          disabled: readOnly,
          value: option.currentValue,
          onChange: (event) => void extras.setConfigOption(option.id, event.currentTarget.value),
          children: option.options.flatMap(
            (item) => "group" in item ? /* @__PURE__ */ jsx("optgroup", { label: item.name, children: item.options.map((nested) => /* @__PURE__ */ jsx("option", { value: nested.value, children: nested.name }, nested.value)) }, item.group) : /* @__PURE__ */ jsx("option", { value: item.value, children: item.name }, item.value)
          )
        }
      )
    ] }, option.id))
  ] });
}
function AcpCommandMenu({
  onSelect,
  children,
  ...props
}) {
  const commands = useAcpCommands();
  if (!commands.length) return null;
  return /* @__PURE__ */ jsxs("div", { ...props, children: [
    children,
    commands.map((command) => /* @__PURE__ */ jsxs(
      "button",
      {
        type: "button",
        title: command.description,
        onClick: () => onSelect?.(`/${command.name}`),
        children: [
          "/",
          command.name
        ]
      },
      command.name
    ))
  ] });
}
function AcpUsage({
  render,
  ...props
}) {
  const usage = useAcpUsage();
  if (!usage) return null;
  return /* @__PURE__ */ jsx("div", { ...props, children: render?.(usage) ?? /* @__PURE__ */ jsxs("span", { children: [
    usage.used,
    "/",
    usage.size,
    usage.cost ? ` \xB7 ${usage.cost.amount} ${usage.cost.currency}` : ""
  ] }) });
}
function AcpToolArtifact({
  artifact,
  ...props
}) {
  const acp = artifact?.acp;
  if (!acp) return null;
  return /* @__PURE__ */ jsxs("div", { ...props, "data-kind": acp.kind, "data-status": acp.status, children: [
    acp.title ? /* @__PURE__ */ jsx("strong", { children: acp.title }) : null,
    acp.content?.map((part, index) => /* @__PURE__ */ jsx("pre", { children: JSON.stringify(part, null, 2) }, index))
  ] });
}
function AcpDataPart({
  name,
  data,
  ...props
}) {
  return /* @__PURE__ */ jsx("div", { ...props, "data-acp-part": name, children: /* @__PURE__ */ jsx("pre", { children: JSON.stringify(data, null, 2) }) });
}
function AcpDiff({ diff, ...props }) {
  return /* @__PURE__ */ jsx("div", { ...props, "data-acp-part": "diff", children: /* @__PURE__ */ jsx("pre", { children: typeof diff === "string" ? diff : JSON.stringify(diff, null, 2) }) });
}
function AcpTerminal({
  terminal,
  ...props
}) {
  return /* @__PURE__ */ jsx("div", { ...props, "data-acp-part": "terminal", children: /* @__PURE__ */ jsx("pre", { children: JSON.stringify(terminal, null, 2) }) });
}
function AcpResource({
  resource,
  ...props
}) {
  const value = resource;
  if (value?.type === "resource_link" && value.uri) {
    return /* @__PURE__ */ jsx("div", { ...props, "data-acp-part": "resource", children: /* @__PURE__ */ jsx("a", { href: value.uri, children: value.title ?? value.name ?? value.uri }) });
  }
  return /* @__PURE__ */ jsx("div", { ...props, "data-acp-part": "resource", children: /* @__PURE__ */ jsx("pre", { children: JSON.stringify(resource, null, 2) }) });
}
function AcpUnsupported({ value, ...props }) {
  return /* @__PURE__ */ jsx("div", { ...props, "data-acp-part": "unsupported", children: /* @__PURE__ */ jsx("pre", { children: JSON.stringify(value, null, 2) }) });
}

export { AcpAuthMethods, AcpCommandMenu, AcpConfigOptions, AcpDataPart, AcpDiff, AcpModeSelect, AcpPermissionList, AcpPlan, AcpResource, AcpTerminal, AcpToolArtifact, AcpUnsupported, AcpUsage, acpExtras, useAcpAuth, useAcpCommands, useAcpConfigOptions, useAcpConnection, useAcpModes, useAcpPermissions, useAcpPlan, useAcpRuntimeExtras, useAcpSession, useAcpThreadState, useAcpUsage };
//# sourceMappingURL=chunk-C5Y43QRL.js.map
//# sourceMappingURL=chunk-C5Y43QRL.js.map