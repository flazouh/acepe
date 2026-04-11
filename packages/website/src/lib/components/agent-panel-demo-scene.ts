import type { AgentTodoItem, AnyAgentEntry } from "@acepe/ui/agent-panel";

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
		searchFiles: [
			"src/middleware/auth.ts",
			"src/lib/auth/session.ts",
			"src/controllers/users_controller.ts",
		],
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
		stdout:
			"bun test v1.1.21\n\n src/lib/auth/jwt.test.ts:\n✓ signs and verifies access tokens [12ms]\n✓ refresh token rotation [8ms]\n\n 2 pass, 0 fail",
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

export interface DemoReviewFile {
	id: string;
	label: string;
	status: "ready" | "reviewing" | "done";
	summary: string;
}

export const AGENT_PANEL_DEMO_REVIEW_FILES: readonly DemoReviewFile[] = [
	{
		id: "review-1",
		label: "src/lib/auth/jwt.ts",
		status: "reviewing",
		summary: "+158 −29",
	},
	{
		id: "review-2",
		label: "src/middleware/auth.ts",
		status: "ready",
		summary: "+42 −16",
	},
	{
		id: "review-3",
		label: "src/controllers/users_controller.ts",
		status: "done",
		summary: "+12 −7",
	},
];

export function buildDemoTodoItems(entryCount: number): readonly AgentTodoItem[] {
	return [
		{
			content: "Create JWT service",
			status: entryCount >= 9 ? "completed" : entryCount >= 7 ? "in_progress" : "pending",
			duration: entryCount >= 9 ? 420000 : 180000,
		},
		{
			content: "Replace session middleware",
			status: entryCount >= 12 ? "completed" : entryCount >= 10 ? "in_progress" : "pending",
			duration: entryCount >= 12 ? 360000 : entryCount >= 10 ? 120000 : null,
		},
		{
			content: "Rotate refresh tokens",
			activeForm: entryCount >= 14 ? "Rotating refresh tokens" : null,
			status: entryCount >= 16 ? "completed" : entryCount >= 14 ? "in_progress" : "pending",
			duration: entryCount >= 16 ? 300000 : entryCount >= 14 ? 90000 : null,
		},
	];
}
