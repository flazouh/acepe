import {
	AGENT_PANEL_ACTION_IDS,
	type AgentPanelActionCallbacks,
	type AgentPanelCardModel,
	type AgentPanelConversationEntry,
	type AgentPanelPlanSidebarItem,
	type AgentPanelSceneModel,
	type AgentPanelSessionStatus,
	type AgentPanelStripModel,
} from "@acepe/agent-panel-contract";
import type { AnyAgentEntry } from "@acepe/ui/agent-panel";

export const AGENT_PANEL_DEMO_SCRIPT: readonly AnyAgentEntry[] = [
	{
		id: "u1",
		type: "user",
		text: "Migrate our auth system to use JWT tokens instead of session cookies",
	},
	{ id: "th1", type: "thinking" },
	{
		id: "t1",
		type: "tool_call",
		kind: "read",
		title: "Read",
		filePath: "src/lib/auth/session.ts",
		status: "done",
	},
	{
		id: "t2",
		type: "tool_call",
		kind: "read",
		title: "Read",
		filePath: "src/middleware/auth.ts",
		status: "done",
	},
	{
		id: "t3",
		type: "tool_call",
		kind: "read",
		title: "Read",
		filePath: "src/controllers/users_controller.ts",
		status: "done",
	},
	{
		id: "t3b",
		type: "tool_call",
		kind: "search",
		title: "Grep",
		query: "session_cookie",
		searchFiles: ["src/middleware/auth.ts", "src/lib/auth/session.ts", "src/controllers/users_controller.ts"],
		searchResultCount: 3,
		status: "done",
	},
	{
		id: "a1",
		type: "assistant",
		markdown: `I'll migrate your auth system to JWT. Here's my plan:

1. Create \`src/lib/auth/jwt.ts\` using the \`jose\` library
2. Add \`refresh_token\` column to the users table
3. Replace session middleware in 3 controllers`,
	},
	{ id: "th2", type: "thinking" },
	{
		id: "t4",
		type: "tool_call",
		kind: "write",
		title: "Write",
		filePath: "src/lib/auth/jwt.ts",
		status: "done",
	},
	{
		id: "t5",
		type: "tool_call",
		kind: "execute",
		title: "Run",
		subtitle: "bun test src/lib/auth",
		command: "bun test src/lib/auth",
		stdout: "bun test v1.1.21\n\n src/lib/auth/jwt.test.ts:\n✓ signs and verifies access tokens [12ms]\n✓ refresh token rotation [8ms]\n\n 2 pass, 0 fail",
		exitCode: 0,
		status: "done",
	},
	{
		id: "t6",
		type: "tool_call",
		kind: "edit",
		title: "Edit",
		filePath: "src/middleware/auth.ts",
		status: "done",
	},
	{
		id: "a2",
		type: "assistant",
		markdown: `JWT service created. Access tokens expire in **15 minutes**, refresh tokens in **7 days**.

> **Security note:** Refresh tokens are stored in \`httpOnly\` cookies — access tokens live in memory only.`,
	},
	{
		id: "u2",
		type: "user",
		text: "Also add automatic refresh token rotation on each use",
	},
	{ id: "th3", type: "thinking" },
	{
		id: "t7",
		type: "tool_call",
		kind: "edit",
		title: "Edit",
		filePath: "src/lib/auth/jwt.ts",
		status: "running",
	},
	{
		id: "a3",
		type: "assistant",
		markdown: "Adding rotation — issuing a new refresh token on every use and revoking the old one…",
		isStreaming: true,
	},
];

export const AGENT_PANEL_DEMO_DELAYS: readonly number[] = [
	0,
	600,
	400,
	300,
	300,
	350,
	600,
	500,
	400,
	350,
	350,
	700,
	800,
	500,
	400,
	600,
];

interface WebsiteAgentPanelSceneOptions {
	panelId: string;
	title: string;
	projectName: string;
	projectColor: string;
	status: AgentPanelSessionStatus;
	entries: readonly AnyAgentEntry[];
	agentLabel?: string;
}

function toConversationEntry(entry: AnyAgentEntry): AgentPanelConversationEntry {
	if (entry.type === "user") {
		return {
			id: entry.id,
			type: "user",
			text: entry.text,
		};
	}

	if (entry.type === "assistant") {
		return {
			id: entry.id,
			type: "assistant",
			markdown: entry.markdown,
			isStreaming: entry.isStreaming,
		};
	}

	if (entry.type === "thinking") {
		return {
			id: entry.id,
			type: "thinking",
		};
	}

	return {
		id: entry.id,
		type: "tool_call",
		kind: entry.kind,
		title: entry.title,
		subtitle: entry.subtitle,
		filePath: entry.filePath,
		status: entry.status,
		command: entry.command,
		stdout: entry.stdout,
		stderr: entry.stderr,
		exitCode: entry.exitCode,
		query: entry.query,
		searchPath: entry.searchPath,
		searchFiles: entry.searchFiles ? Array.from(entry.searchFiles) : undefined,
		searchResultCount: entry.searchResultCount,
		url: entry.url,
		resultText: entry.resultText,
		webSearchLinks: entry.webSearchLinks ? Array.from(entry.webSearchLinks) : undefined,
		webSearchSummary: entry.webSearchSummary,
		taskDescription: entry.taskDescription,
		taskPrompt: entry.taskPrompt,
		taskResultText: entry.taskResultText,
		taskChildren: entry.taskChildren ? entry.taskChildren.map((child) => toConversationEntry(child)) : undefined,
	};
}

function resolvePlanItems(entryCount: number): readonly AgentPanelPlanSidebarItem[] {
	const createJwtStatus = entryCount >= 9 ? "done" : entryCount >= 7 ? "in_progress" : "pending";
	const updateMiddlewareStatus = entryCount >= 12 ? "done" : entryCount >= 9 ? "in_progress" : "pending";
	const rotateRefreshStatus = entryCount >= 16 ? "done" : entryCount >= 14 ? "in_progress" : "pending";

	return [
		{
			id: "plan-1",
			label: "Create JWT service",
			status: createJwtStatus,
			description: "Add jose-based signing and verification helpers.",
		},
		{
			id: "plan-2",
			label: "Replace session middleware",
			status: updateMiddlewareStatus,
			description: "Switch protected routes to token-based auth.",
		},
		{
			id: "plan-3",
			label: "Rotate refresh tokens",
			status: rotateRefreshStatus,
			description: "Issue and revoke refresh tokens on every use.",
		},
	];
}

function resolveStrips(status: AgentPanelSessionStatus, entryCount: number): readonly AgentPanelStripModel[] {
	const strips: AgentPanelStripModel[] = [];

	if (entryCount >= 7) {
		strips.push({
			id: "plan-strip",
			kind: "plan_header",
			title: "Execution plan ready",
			description: "3 implementation steps tracked in the sidebar.",
			actions: [
				{
					id: AGENT_PANEL_ACTION_IDS.plan.toggleSidebar,
					label: "View plan",
					state: "enabled",
				},
			],
		});
	}

	if (status === "running" || status === "done") {
		strips.push({
			id: "modified-files-strip",
			kind: "modified_files",
			title: "Modified files",
			items: [
				{ id: "mf-1", label: "Files", value: entryCount >= 12 ? "3" : "1" },
				{ id: "mf-2", label: "Tests", value: entryCount >= 10 ? "Updated" : "Pending" },
			],
			actions: [
				{
					id: AGENT_PANEL_ACTION_IDS.review.openFullscreen,
					label: "Review",
					state: "enabled",
				},
			],
		});
	}

	return strips;
}

function resolveCards(status: AgentPanelSessionStatus, entryCount: number): readonly AgentPanelCardModel[] {
	if (status === "idle") {
		return [];
	}

	return [
		{
			id: "pr-card",
			kind: entryCount >= 12 ? "pr_status" : "review",
			title: entryCount >= 12 ? "PR summary" : "Review in progress",
			description:
				entryCount >= 12
					? "JWT migration is ready for review with tests updated."
					: "Agent is still rewriting middleware and validating auth flows.",
			meta: [
				{ id: "meta-1", label: "Files changed", value: entryCount >= 12 ? "3" : "1" },
				{ id: "meta-2", label: "Checks", value: entryCount >= 10 ? "Passing" : "Running" },
			],
			actions: [
				{
					id: AGENT_PANEL_ACTION_IDS.review.openFullscreen,
					label: entryCount >= 12 ? "Open diff" : "Follow work",
					state: "enabled",
				},
			],
		},
	];
}

export const websiteAgentPanelDemoCallbacks: AgentPanelActionCallbacks = {
	[AGENT_PANEL_ACTION_IDS.composer.attachFile]: () => undefined,
	[AGENT_PANEL_ACTION_IDS.composer.selectModel]: () => undefined,
	[AGENT_PANEL_ACTION_IDS.composer.submit]: () => undefined,
	[AGENT_PANEL_ACTION_IDS.header.copySessionMarkdown]: () => undefined,
	[AGENT_PANEL_ACTION_IDS.plan.toggleSidebar]: () => undefined,
	[AGENT_PANEL_ACTION_IDS.review.openFullscreen]: () => undefined,
};

export function buildWebsiteAgentPanelScene(
	options: WebsiteAgentPanelSceneOptions
): AgentPanelSceneModel {
	const entryCount = options.entries.length;
	const conversationEntries = options.entries.map((entry) => toConversationEntry(entry));

	return {
		panelId: options.panelId,
		status: options.status,
		header: {
			title: options.title,
			subtitle: options.status === "done" ? "Ready to review" : "Live agent session",
			status: options.status,
			agentLabel: options.agentLabel ?? "Claude Code",
			projectLabel: options.projectName,
			projectColor: options.projectColor,
			badges: [
				{
					id: "badge-status",
					label: options.status === "done" ? "Complete" : "Streaming",
				},
			],
			actions: [
				{
					id: AGENT_PANEL_ACTION_IDS.header.copySessionMarkdown,
					label: "Copy",
					state: "enabled",
				},
			],
		},
		conversation: {
			entries: conversationEntries,
			isStreaming: options.status === "running",
		},
		composer: {
			draftText: "",
			placeholder: "Ask your agent to keep going…",
			submitLabel: "Send",
			canSubmit: true,
			selectedModel: {
				id: "claude-3.7-sonnet",
				label: "Claude 3.7 Sonnet",
				projectLabel: options.projectName,
			},
			attachments: [
				{
					id: "attachment-1",
					label: "auth-migration-notes.md",
					kind: "file",
				},
			],
			actions: [
				{
					id: AGENT_PANEL_ACTION_IDS.composer.attachFile,
					label: "Attach",
					state: "enabled",
				},
				{
					id: AGENT_PANEL_ACTION_IDS.composer.selectModel,
					label: "Model",
					state: "enabled",
				},
				{
					id: AGENT_PANEL_ACTION_IDS.composer.submit,
					label: "Send",
					state: "enabled",
				},
			],
		},
		strips: resolveStrips(options.status, entryCount),
		cards: resolveCards(options.status, entryCount),
		sidebars: {
			plan: {
				title: "Execution plan",
				items: resolvePlanItems(entryCount),
				actions: [
					{
						id: AGENT_PANEL_ACTION_IDS.plan.toggleSidebar,
						label: "Collapse",
						state: "enabled",
					},
				],
			},
		},
		chrome: {
			isFocused: true,
		},
	};
}
