<script lang="ts">
import { AgentPanelLayout, type AnyAgentEntry } from "@acepe/ui/agent-panel";
import {
	SectionedFeed,
	FeedItem,
	type SectionedFeedGroup,
	type SectionedFeedItemData,
} from "@acepe/ui/attention-queue";
import {
	AppMainLayout,
	AppTabBarGrouped,
	AppTabBarTab,
	AppTopBar,
	AppSidebarProjectGroup,
	type AppTabGroup,
	type AppTab,
	type AppProjectGroup,
} from "@acepe/ui/app-layout";
import { ProjectLetterBadge, TextShimmer, DiffPill } from "@acepe/ui";
import { ProjectCard } from "@acepe/ui/project-card";

const ACEPE_COLOR = "#7C3AED";
const ACEPE_NAME = "acepe";
const MYAPP_COLOR = "#0EA5E9";
const MYAPP_NAME = "myapp";

// ── Panel 1: Claude — JWT migration ──────────────────────────────────
const P1_SCRIPT: AnyAgentEntry[] = [
	{ id: "u1", type: "user", text: "Migrate our auth system to JWT tokens" },
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
		kind: "search",
		title: "Grep",
		query: "session_cookie",
		searchFiles: ["src/middleware/auth.ts", "src/lib/auth/session.ts"],
		searchResultCount: 2,
		status: "done",
	},
	{
		id: "a1",
		type: "assistant",
		markdown: `Migrating to JWT:\n\n1. Create \`jwt.ts\` with \`jose\`\n2. Update auth middleware\n3. Add refresh token rotation`,
	},
	{
		id: "t3",
		type: "tool_call",
		kind: "write",
		title: "Write",
		filePath: "src/lib/auth/jwt.ts",
		status: "done",
	},
	{
		id: "t4",
		type: "tool_call",
		kind: "execute",
		title: "Run",
		command: "bun test src/lib/auth",
		stdout: "✓ signs tokens [12ms]\n✓ refresh rotation [8ms]\n\n2 pass, 0 fail",
		exitCode: 0,
		status: "done",
	},
	{
		id: "a2",
		type: "assistant",
		markdown: "JWT ready. Tokens expire in **15min**, refresh in **7 days**.",
		isStreaming: true,
	},
];
const P1_DELAYS = [0, 500, 350, 350, 600, 400, 400, 650];

// ── Panel 2: Codex — N+1 queries ─────────────────────────────────────
const P2_SCRIPT: AnyAgentEntry[] = [
	{ id: "u1", type: "user", text: "Fix the N+1 queries on the users endpoint" },
	{ id: "th1", type: "thinking" },
	{
		id: "t1",
		type: "tool_call",
		kind: "read",
		title: "Read",
		filePath: "app/controllers/users_controller.rb",
		status: "done",
	},
	{
		id: "t2",
		type: "tool_call",
		kind: "search",
		title: "Grep",
		query: "User.find",
		searchFiles: ["app/controllers/users_controller.rb", "app/models/user.rb"],
		searchResultCount: 4,
		status: "done",
	},
	{
		id: "a1",
		type: "assistant",
		markdown: `Found **3 N+1 queries** in the \`index\` action. Adding eager loading.`,
	},
	{
		id: "t3",
		type: "tool_call",
		kind: "edit",
		title: "Edit",
		filePath: "app/controllers/users_controller.rb",
		status: "done",
	},
	{
		id: "t4",
		type: "tool_call",
		kind: "execute",
		title: "Run",
		command: "rails test test/controllers/",
		stdout: "3 runs, 3 assertions, 0 failures",
		exitCode: 0,
		status: "done",
	},
	{
		id: "a2",
		type: "assistant",
		markdown: "Queries reduced from **47 to 3** with `includes(:roles, :profile)`.",
		isStreaming: true,
	},
];
const P2_DELAYS = [0, 500, 350, 350, 550, 400, 400, 600];

// ── Panel 3: OpenCode — TypeScript strict ─────────────────────────────
const P3_SCRIPT: AnyAgentEntry[] = [
	{ id: "u1", type: "user", text: "Enable TypeScript strict mode and fix all errors" },
	{ id: "th1", type: "thinking" },
	{
		id: "t1",
		type: "tool_call",
		kind: "execute",
		title: "Run",
		command: "tsc --strict --noEmit",
		stdout:
			"src/api/users.ts(14,12): error TS2345\nsrc/utils/format.ts(8,5): error TS2322\nsrc/hooks/useAuth.ts(22,8): error TS2339\n\n3 errors",
		exitCode: 1,
		status: "done",
	},
	{
		id: "a1",
		type: "assistant",
		markdown: `Found **3 type errors** across 3 files. Fixing now.`,
	},
	{
		id: "t2",
		type: "tool_call",
		kind: "edit",
		title: "Edit",
		filePath: "src/api/users.ts",
		status: "done",
	},
	{
		id: "t3",
		type: "tool_call",
		kind: "edit",
		title: "Edit",
		filePath: "src/utils/format.ts",
		status: "done",
	},
	{
		id: "t4",
		type: "tool_call",
		kind: "edit",
		title: "Edit",
		filePath: "src/hooks/useAuth.ts",
		status: "done",
	},
	{
		id: "a2",
		type: "assistant",
		markdown: "`strict: true` enabled — **0 errors** remain.",
		isStreaming: true,
	},
];
const P3_DELAYS = [0, 500, 450, 600, 400, 350, 350, 600];

// ── Animation state ───────────────────────────────────────────────────
let p1Count = $state(0);
let p2Count = $state(0);
let p3Count = $state(0);
let animating = $state(false);

const p1Entries = $derived(P1_SCRIPT.slice(0, p1Count));
const p2Entries = $derived(P2_SCRIPT.slice(0, p2Count));
const p3Entries = $derived(P3_SCRIPT.slice(0, p3Count));

function panelStatus(count: number, total: number): "idle" | "running" | "done" {
	if (count === 0) return "idle";
	if (count >= total) return "done";
	return "running";
}

const p1Status = $derived(panelStatus(p1Count, P1_SCRIPT.length));
const p2Status = $derived(panelStatus(p2Count, P2_SCRIPT.length));
const p3Status = $derived(panelStatus(p3Count, P3_SCRIPT.length));

const allDone = $derived(
	p1Count >= P1_SCRIPT.length && p2Count >= P2_SCRIPT.length && p3Count >= P3_SCRIPT.length
);

async function runPanel(
	script: AnyAgentEntry[],
	delays: number[],
	startDelay: number,
	setCount: (n: number) => void
) {
	await new Promise<void>((r) => setTimeout(r, startDelay));
	for (let i = 0; i < script.length; i++) {
		await new Promise<void>((r) => setTimeout(r, delays[i] ?? 400));
		setCount(i + 1);
	}
}

async function playAll() {
	if (animating) return;
	animating = true;
	p1Count = 0;
	p2Count = 0;
	p3Count = 0;
	await Promise.all([
		runPanel(P1_SCRIPT, P1_DELAYS, 0, (n) => {
			p1Count = n;
		}),
		runPanel(P2_SCRIPT, P2_DELAYS, 1300, (n) => {
			p2Count = n;
		}),
		runPanel(P3_SCRIPT, P3_DELAYS, 2500, (n) => {
			p3Count = n;
		}),
	]);
	animating = false;
}

$effect(() => {
	const t = setTimeout(() => playAll(), 400);
	return () => clearTimeout(t);
});

// ── Tab bar groups ───────────────────────────────────────────────────
const tabGroups = $derived<AppTabGroup[]>([
	{
		projectName: ACEPE_NAME,
		projectColor: ACEPE_COLOR,
		tabs: [
			{
				id: "p1",
				title: "Migrate auth to JWT",
				agentIconSrc: "/svgs/agents/claude/claude-icon-dark.svg",
				mode: "build",
				status: p1Status,
				isFocused: true,
			},
			{
				id: "p2",
				title: "Fix N+1 queries",
				agentIconSrc: "/svgs/agents/codex/codex-icon-dark.svg",
				mode: "build",
				status: p2Status,
				isFocused: false,
			},
			{
				id: "p3",
				title: "TypeScript strict mode",
				agentIconSrc: "/svgs/agents/opencode/opencode-logo-dark.svg",
				mode: "build",
				status: p3Status,
				isFocused: false,
			},
		],
	},
	{
		projectName: MYAPP_NAME,
		projectColor: MYAPP_COLOR,
		tabs: [
			{
				id: "myapp-1",
				title: "Setup CI pipeline",
				agentIconSrc: "/svgs/agents/claude/claude-icon-dark.svg",
				status: "idle",
				isFocused: false,
			},
		],
	},
]);

// ── Queue feed ───────────────────────────────────────────────────────
interface QueueItem extends SectionedFeedItemData {
	id: string;
	title: string;
	agentIconSrc: string;
	projectName: string;
	projectColor: string;
	shimmerText?: string;
	insertions?: number;
	deletions?: number;
}

const queueGroups: SectionedFeedGroup<QueueItem>[] = $derived.by(() => {
	const working: QueueItem[] = [];
	const finished: QueueItem[] = [];

	if (p1Status === "running") {
		working.push({
			id: "p1",
			title: "Migrate auth to JWT",
			agentIconSrc: "/svgs/agents/claude/claude-icon-dark.svg",
			projectName: ACEPE_NAME,
			projectColor: ACEPE_COLOR,
			shimmerText: "Reading auth/session.ts",
		});
	} else if (p1Status === "done") {
		finished.push({
			id: "p1",
			title: "Migrate auth to JWT",
			agentIconSrc: "/svgs/agents/claude/claude-icon-dark.svg",
			projectName: ACEPE_NAME,
			projectColor: ACEPE_COLOR,
			insertions: 42,
			deletions: 8,
		});
	}

	if (p2Status === "running") {
		working.push({
			id: "p2",
			title: "Fix N+1 queries",
			agentIconSrc: "/svgs/agents/codex/codex-icon-dark.svg",
			projectName: ACEPE_NAME,
			projectColor: ACEPE_COLOR,
			shimmerText: "Searching User.find",
		});
	} else if (p2Status === "done") {
		finished.push({
			id: "p2",
			title: "Fix N+1 queries",
			agentIconSrc: "/svgs/agents/codex/codex-icon-dark.svg",
			projectName: ACEPE_NAME,
			projectColor: ACEPE_COLOR,
			insertions: 12,
			deletions: 31,
		});
	}

	if (p3Status === "running") {
		working.push({
			id: "p3",
			title: "TypeScript strict mode",
			agentIconSrc: "/svgs/agents/opencode/opencode-logo-dark.svg",
			projectName: ACEPE_NAME,
			projectColor: ACEPE_COLOR,
			shimmerText: "Editing src/api/users.ts",
		});
	} else if (p3Status === "done") {
		finished.push({
			id: "p3",
			title: "TypeScript strict mode",
			agentIconSrc: "/svgs/agents/opencode/opencode-logo-dark.svg",
			projectName: ACEPE_NAME,
			projectColor: ACEPE_COLOR,
			insertions: 18,
			deletions: 5,
		});
	}

	const groups: SectionedFeedGroup<QueueItem>[] = [];
	if (working.length > 0) {
		groups.push({ id: "working", label: "Working", items: working });
	}
	if (finished.length > 0) {
		groups.push({ id: "needs_review", label: "Needs Review", items: finished });
	}
	return groups;
});

const queueTotalCount = $derived(queueGroups.reduce((sum, g) => sum + g.items.length, 0));

// ── Sidebar data ──────────────────────────────────────────────────────
const acepeGroup = $derived<AppProjectGroup>({
	name: ACEPE_NAME,
	color: ACEPE_COLOR,
	sessions: [
		{
			id: "p1",
			title: "Migrate auth to JWT",
			agentIconSrc: "/svgs/agents/claude/claude-icon-dark.svg",
			status: p1Status,
			isActive: true,
		},
		{
			id: "p2",
			title: "Fix N+1 queries",
			agentIconSrc: "/svgs/agents/codex/codex-icon-dark.svg",
			status: p2Status,
			isActive: false,
		},
		{
			id: "p3",
			title: "TypeScript strict mode",
			agentIconSrc: "/svgs/agents/opencode/opencode-logo-dark.svg",
			status: p3Status,
			isActive: false,
		},
	],
});

const myappGroup: AppProjectGroup = {
	name: MYAPP_NAME,
	color: MYAPP_COLOR,
	sessions: [
		{
			id: "myapp-1",
			title: "Setup CI pipeline",
			agentIconSrc: "/svgs/agents/claude/claude-icon-dark.svg",
			status: "idle",
			isActive: false,
		},
	],
};
</script>

<!-- macOS-style app window — bg-primary p-1 matches ThemeProvider outer frame in desktop -->
<div class="relative overflow-hidden rounded-2xl shadow-2xl bg-primary p-1" style="height: 700px;">
	<AppMainLayout>
		{#snippet tabBar()}
			<AppTopBar />
			<AppTabBarGrouped groups={tabGroups}>
				{#snippet tabRenderer(tab: AppTab)}
					<AppTabBarTab {tab} />
				{/snippet}
			</AppTabBarGrouped>
		{/snippet}

		{#snippet sidebar()}
			<aside class="flex w-[280px] shrink-0 flex-col overflow-hidden border-r border-border/40">
				<!-- Queue -->
				<div class="shrink-0 px-1.5 pt-1.5">
					<SectionedFeed
						groups={queueGroups}
						totalCount={queueTotalCount}
					>
						{#snippet itemRenderer(item)}
							{@const queueItem = item as QueueItem}
							<FeedItem>
								<div class="flex items-center gap-1.5">
									<ProjectLetterBadge
										name={queueItem.projectName}
										color={queueItem.projectColor}
										size={14}
									/>
									<img src={queueItem.agentIconSrc} alt="" class="h-3.5 w-3.5 shrink-0" />
									<span class="min-w-0 flex-1 truncate text-xs font-medium">{queueItem.title}</span>
									{#if queueItem.insertions || queueItem.deletions}
										<DiffPill
											insertions={queueItem.insertions ?? 0}
											deletions={queueItem.deletions ?? 0}
											variant="plain"
										/>
									{/if}
								</div>
								{#if queueItem.shimmerText}
									<div class="text-[10px] text-muted-foreground">
										<TextShimmer>{queueItem.shimmerText}</TextShimmer>
									</div>
								{/if}
							</FeedItem>
						{/snippet}
					</SectionedFeed>
				</div>

				<!-- Session list -->
				<div class="flex flex-1 flex-col gap-0.5 overflow-y-auto px-1.5 py-1.5">
					<AppSidebarProjectGroup group={acepeGroup} />
					<div class="mt-2">
						<AppSidebarProjectGroup group={myappGroup} />
					</div>
				</div>

				<div class="shrink-0 px-3 py-2 text-[10px] text-muted-foreground/40 select-none">
					v0.4.2
				</div>
			</aside>
		{/snippet}

		{#snippet panels()}
			<div class="flex min-h-0 flex-1 p-0.5">
				<ProjectCard
					projectName={ACEPE_NAME}
					projectColor={ACEPE_COLOR}
					variant="corner"
					class="flex-1 min-w-0"
				>
					<div
						class="min-w-0 flex-1 overflow-hidden rounded-lg border border-border/30 bg-background"
					>
						<AgentPanelLayout
							entries={p1Entries}
							projectName={ACEPE_NAME}
							projectColor={ACEPE_COLOR}
							sessionTitle="Migrate auth to JWT"
							agentIconSrc="/svgs/agents/claude/claude-icon-dark.svg"
							sessionStatus={p1Status}
							iconBasePath="/svgs/icons"
						/>
					</div>
					<div
						class="min-w-0 flex-1 overflow-hidden rounded-lg border border-border/30 bg-background"
					>
						<AgentPanelLayout
							entries={p2Entries}
							projectName={ACEPE_NAME}
							projectColor={ACEPE_COLOR}
							sessionTitle="Fix N+1 queries"
							agentIconSrc="/svgs/agents/codex/codex-icon-dark.svg"
							sessionStatus={p2Status}
							iconBasePath="/svgs/icons"
						/>
					</div>
					<div
						class="min-w-0 flex-1 overflow-hidden rounded-lg border border-border/30 bg-background"
					>
						<AgentPanelLayout
							entries={p3Entries}
							projectName={ACEPE_NAME}
							projectColor={ACEPE_COLOR}
							sessionTitle="TypeScript strict mode"
							agentIconSrc="/svgs/agents/opencode/opencode-logo-dark.svg"
							sessionStatus={p3Status}
							iconBasePath="/svgs/icons"
						/>
					</div>
				</ProjectCard>
			</div>
		{/snippet}
	</AppMainLayout>

	{#if allDone && !animating}
		<button
			onclick={() => playAll()}
			class="absolute right-4 bottom-4 rounded-full border border-border bg-muted/80 px-3 py-1 text-xs text-muted-foreground backdrop-blur-sm transition-colors hover:bg-muted hover:text-foreground"
		>
			↺ Replay
		</button>
	{/if}
</div>
