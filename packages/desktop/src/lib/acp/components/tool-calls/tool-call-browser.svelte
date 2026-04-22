<script lang="ts">
import { AgentToolBrowser } from "@acepe/ui/agent-panel";
import type { TurnState } from "../../store/types.js";
import type { ToolCall } from "../../types/tool-call.js";
import { getToolStatus } from "../../utils/tool-state-utils.js";
import { extractBrowserDetailsText, extractBrowserScriptText } from "./browser-tool-display.js";

interface Props {
	toolCall: ToolCall;
	turnState?: TurnState;
	projectPath?: string;
	elapsedLabel?: string | null;
}

let { toolCall, turnState, elapsedLabel }: Props = $props();

const toolStatus = $derived(getToolStatus(toolCall, turnState));

const agentStatus = $derived.by(() => {
	if (toolStatus.isPending) return "running" as const;
	if (toolStatus.isError) return "error" as const;
	return "done" as const;
});

const title = $derived(formatBrowserToolTitle(toolCall.name));
const subtitle = $derived(extractBrowserSubtitle(toolCall));
const scriptText = $derived(extractBrowserScriptText(toolCall));

const detailsText = $derived(extractBrowserDetailsText(toolCall));

function extractFuncName(name: string): string {
	// "mcp__server__func_name" → "func_name"
	const segments = name.split("__");
	const last = segments[segments.length - 1] ?? name;
	// "server-func_name" → "func_name"
	const dashIdx = last.indexOf("-");
	return dashIdx >= 0 ? last.slice(dashIdx + 1) : last;
}

function formatBrowserToolTitle(name: string): string {
	const funcName = extractFuncName(name);
	return funcName
		.replace(/^webview_/, "")
		.replace(/^ipc_/, "IPC ")
		.replace(/_/g, " ")
		.split(" ")
		.filter((w) => w.length > 0)
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(" ");
}

function extractBrowserSubtitle(tc: ToolCall): string | null {
	const raw =
		tc.arguments.kind === "browser" || tc.arguments.kind === "other" ? tc.arguments.raw : null;
	if (!raw || typeof raw !== "object") return null;
	const obj = raw as Record<string, unknown>;

	// webview_execute_js — show script snippet
	if (typeof obj.script === "string") {
		const s = (obj.script as string).replace(/\s+/g, " ").trim();
		return s.length > 60 ? `${s.slice(0, 60)}…` : s;
	}
	// webview_dom_snapshot — show type
	if (typeof obj.type === "string") {
		return obj.type as string;
	}
	// webview_find_element / interact / keyboard — show selector or action
	if (typeof obj.selector === "string") {
		const action = typeof obj.action === "string" ? `${obj.action} ` : "";
		return `${action}${obj.selector}`;
	}
	if (typeof obj.action === "string") {
		return obj.action as string;
	}
	// driver_session
	if (typeof obj.action === "string" && extractFuncName(tc.name) === "driver_session") {
		return obj.action as string;
	}
	// ipc_execute_command
	if (typeof obj.command === "string") {
		return obj.command as string;
	}
	// read_logs
	if (typeof obj.source === "string") {
		return obj.source as string;
	}
	return null;
}
</script>

<AgentToolBrowser
	{title}
	{subtitle}
	{scriptText}
	{detailsText}
	status={agentStatus}
	durationLabel={elapsedLabel ?? undefined}
/>
