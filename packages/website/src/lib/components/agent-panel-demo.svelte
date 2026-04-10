<script lang="ts">
/**
 * Agent Panel demo for the homepage features section.
 * Animates through a realistic JWT migration session using shared AgentPanelLayout.
 */
import { AgentPanelLayout, type AnyAgentEntry } from "@acepe/ui/agent-panel";

// Full session script — entries revealed one-by-one via animation
const FULL_SCRIPT: AnyAgentEntry[] = [
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
		markdown:
			"Adding rotation — issuing a new refresh token on every use and revoking the old one…",
		isStreaming: true,
	},
];

// Timings in ms between each entry appearing
const DELAYS = [
	0, // u1 — instant
	600, // th1
	400, // t1
	300, // t2
	300, // t3
	350, // t3b (search)
	600, // a1
	500, // th2
	400, // t4
	350, // t5
	350, // t6
	700, // a2
	800, // u2
	500, // th3
	400, // t7
	600, // a3 (streaming)
];

let visibleCount = $state(0);
let animating = $state(false);

const entries = $derived(FULL_SCRIPT.slice(0, visibleCount));

const sessionStatus = $derived(
	visibleCount === 0 ? "idle" : visibleCount >= FULL_SCRIPT.length ? "done" : "running"
) as "idle" | "running" | "done";

async function play() {
	if (animating) return;
	animating = true;
	visibleCount = 0;

	for (let i = 0; i < FULL_SCRIPT.length; i++) {
		const delay = DELAYS[i] ?? 400;
		await new Promise<void>((resolve) => setTimeout(resolve, delay));
		visibleCount = i + 1;
	}

	animating = false;
}

// Start playing on mount after a short delay
$effect(() => {
	const timer = setTimeout(() => play(), 300);
	return () => clearTimeout(timer);
});
</script>

<div class="h-full relative">
	<AgentPanelLayout
		{entries}
		projectName="acepe"
		projectColor="#7C3AED"
		sessionTitle="Migrate auth to JWT"
		agentIconSrc="/svgs/claude-icon-dark.svg"
		{sessionStatus}
		iconBasePath="/svgs/icons"
	/>

	{#if !animating && visibleCount >= FULL_SCRIPT.length}
		<button
			onclick={() => play()}
			class="absolute bottom-20 right-4 rounded-full bg-muted/80 border border-border px-3 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors backdrop-blur-sm"
		>
			↺ Replay
		</button>
	{/if}
</div>
