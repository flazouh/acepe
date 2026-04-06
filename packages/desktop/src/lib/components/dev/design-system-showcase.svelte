<script lang="ts">
	import VoiceDownloadProgress from "$lib/components/voice-download-progress.svelte";
	import IconDotsVertical from "@tabler/icons-svelte/icons/dots-vertical";
	import { Button } from "@acepe/ui/button";
	import * as DropdownMenu from "@acepe/ui/dropdown-menu";
	import {
		CloseAction,
		EmbeddedIconButton,
		EmbeddedPanelHeader,
		HeaderActionCell,
		HeaderCell,
		HeaderTitleCell,
	} from "@acepe/ui/panel-header";
	import {
		AttentionQueueQuestionCard,
		AgentToolTask,
		type ActivityEntryQuestion,
		type ActivityEntryQuestionOption,
		type ActivityEntryQuestionProgress,
		DiffPill,
		FilePathBadge,
		GitBranchBadge,
		GitHubBadge,
		InlineArtefactBadge,
		KanbanCard,
		PillButton,
		ProjectLetterBadge,
		type AgentToolEntry,
		type AnyAgentEntry,
		type KanbanCardData,
	} from "@acepe/ui";
	import CheckCircle from "phosphor-svelte/lib/CheckCircle";
	import X from "phosphor-svelte/lib/X";
	import Kanban from "phosphor-svelte/lib/Kanban";
	import Rows from "phosphor-svelte/lib/Rows";
	import Palette from "phosphor-svelte/lib/Palette";
	import Robot from "phosphor-svelte/lib/Robot";
	import ShieldCheck from "phosphor-svelte/lib/ShieldCheck";
	import ShieldWarning from "phosphor-svelte/lib/ShieldWarning";
	import Tag from "phosphor-svelte/lib/Tag";
	import XCircle from "phosphor-svelte/lib/XCircle";

	import PermissionBar from "$lib/acp/components/tool-calls/permission-bar.svelte";
	import type { PermissionRequest } from "$lib/acp/types/permission.js";

	interface Props {
		open: boolean;
		onOpenChange: (open: boolean) => void;
	}

	let { open, onOpenChange }: Props = $props();

	type SidebarItem = { id: string; label: string; icon: "palette" | "shield" | "kanban" | "tag" | "robot" | "panel" };
	const sidebarItems: SidebarItem[] = [
		{ id: "button", label: "Buttons", icon: "palette" },
		{ id: "badges", label: "Badges & Chips", icon: "tag" },
		{ id: "panel-header", label: "Panel Header", icon: "panel" },
		{ id: "permission-card", label: "Permission Card", icon: "shield" },
		{ id: "kanban-card", label: "Kanban Card", icon: "kanban" },
		{ id: "agent-tool-task", label: "Agent Tool Task", icon: "robot" },
	];

	const demoCardBase: KanbanCardData = {
		id: "demo-1",
		title: "Refactor auth module",
		agentIconSrc: "/svgs/icons/claude.svg",
		agentLabel: "claude",
		projectName: "acepe",
		projectColor: "#9858FF",
		timeAgo: "2m",
		activityText: null,
		isStreaming: false,
		modeId: "build",
		diffInsertions: 42,
		diffDeletions: 8,
		errorText: null,
		todoProgress: { current: 3, total: 5, label: "Implement" },
		taskCard: null,
		latestTool: null,
		hasUnseenCompletion: false,
		sequenceId: 1,
	};

	const demoCardStreaming: KanbanCardData = {
		id: "demo-2",
		title: "Add i18n support",
		agentIconSrc: "/svgs/icons/claude.svg",
		agentLabel: "claude",
		projectName: "web",
		projectColor: "#3B82F6",
		timeAgo: "now",
		activityText: "Thinking…",
		isStreaming: true,
		modeId: "plan",
		diffInsertions: 0,
		diffDeletions: 0,
		errorText: null,
		todoProgress: null,
		taskCard: null,
		latestTool: null,
		hasUnseenCompletion: false,
		sequenceId: 2,
	};

	const demoCardWithTool: KanbanCardData = {
		id: "demo-3",
		title: "Fix login redirect",
		agentIconSrc: "/svgs/icons/claude.svg",
		agentLabel: "claude",
		projectName: "acepe",
		projectColor: "#9858FF",
		timeAgo: "5m",
		activityText: null,
		isStreaming: true,
		modeId: "build",
		diffInsertions: 12,
		diffDeletions: 3,
		errorText: null,
		todoProgress: null,
		taskCard: null,
		latestTool: {
			id: "tool-1",
			kind: "edit",
			title: "Editing",
			filePath: "src/lib/auth.ts",
			status: "running",
		},
		hasUnseenCompletion: false,
		sequenceId: 3,
	};

	const demoCardError: KanbanCardData = {
		id: "demo-4",
		title: "Deploy pipeline",
		agentIconSrc: "/svgs/icons/claude.svg",
		agentLabel: "claude",
		projectName: "infra",
		projectColor: "#EF4444",
		timeAgo: "12m",
		activityText: null,
		isStreaming: false,
		modeId: "build",
		diffInsertions: 0,
		diffDeletions: 0,
		errorText: "Connection error",
		todoProgress: null,
		taskCard: null,
		latestTool: null,
		hasUnseenCompletion: false,
		sequenceId: null,
	};

	const demoCardNeedsReview: KanbanCardData = {
		id: "demo-4b",
		title: "Review kanban status transitions",
		agentIconSrc: "/svgs/icons/claude.svg",
		agentLabel: "claude",
		projectName: "desktop",
		projectColor: "#4AD0FF",
		timeAgo: "8m",
		activityText: null,
		isStreaming: false,
		modeId: "build",
		diffInsertions: 7,
		diffDeletions: 1,
		errorText: null,
		todoProgress: null,
		taskCard: null,
		latestTool: {
			id: "tool-review-1",
			kind: "execute",
			title: "Ran kanban contract tests",
			filePath: undefined,
			status: "done",
		},
		hasUnseenCompletion: true,
	};

	const demoSubagentToolCalls: readonly AgentToolEntry[] = [
		{
			id: "subagent-tool-1",
			type: "tool_call",
			kind: "search",
			title: "Search",
			subtitle: "queue reconciliation",
			status: "done",
		},
		{
			id: "subagent-tool-2",
			type: "tool_call",
			kind: "edit",
			title: "Edit",
			filePath: "src/lib/acp/store/queue-reducer.ts",
			status: "done",
		},
	];

	const demoCardSubagent: KanbanCardData = {
		id: "demo-5",
		title: "Inspect queue reconciliation",
		agentIconSrc: "/svgs/icons/claude.svg",
		agentLabel: "claude",
		projectName: "desktop",
		projectColor: "#22C55E",
		timeAgo: "1m",
		activityText: null,
		isStreaming: true,
		modeId: "build",
		diffInsertions: 9,
		diffDeletions: 2,
		errorText: null,
		todoProgress: { current: 2, total: 3, label: "Inspect" },
		taskCard: {
			summary: "Inspect queue reconciliation",
			isStreaming: true,
			latestTool: {
				id: "subagent-tool-2",
				kind: "edit",
				title: "Editing",
				filePath: "src/lib/acp/store/queue-reducer.ts",
				status: "running",
			},
			toolCalls: demoSubagentToolCalls,
		},
		latestTool: null,
		hasUnseenCompletion: false,
		sequenceId: 4,
	};

	const demoCurrentSubagentToolCalls: readonly AgentToolEntry[] = [
		{
			id: "current-subagent-1",
			type: "tool_call",
			kind: "task",
			title: "Task completed",
			subtitle: "Trace active task mapping in kanban view",
			status: "done",
		},
		{
			id: "current-subagent-2",
			type: "tool_call",
			kind: "task",
			title: "Task completed",
			subtitle: "Verify current task children survive thinking state",
			status: "done",
		},
		{
			id: "current-subagent-3",
			type: "tool_call",
			kind: "task",
			title: "Task running",
			subtitle: "Update design system specimen for multi-subagent cards",
			status: "running",
		},
	];

	const demoCardMultiSubagent: KanbanCardData = {
		id: "demo-6",
		title: "Repair kanban subagent visibility",
		agentIconSrc: "/svgs/icons/claude.svg",
		agentLabel: "claude",
		projectName: "desktop",
		projectColor: "#F59E0B",
		timeAgo: "now",
		activityText: null,
		isStreaming: true,
		modeId: "build",
		diffInsertions: 14,
		diffDeletions: 1,
		errorText: null,
		todoProgress: { current: 2, total: 4, label: "Fix" },
		taskCard: {
			summary: "Repair kanban subagent visibility",
			isStreaming: true,
			latestTool: {
				id: "current-subagent-3",
				kind: "task",
				title: "Task running",
				filePath: undefined,
				status: "running",
			},
			toolCalls: demoCurrentSubagentToolCalls,
		},
		latestTool: null,
		hasUnseenCompletion: false,
		sequenceId: 5,
	};

	const demoCardPermission: KanbanCardData = {
		id: "demo-7",
		title: "Approve workspace command",
		agentIconSrc: "/svgs/icons/claude.svg",
		agentLabel: "claude",
		projectName: "acepe",
		projectColor: "#9858FF",
		timeAgo: "now",
		activityText: "Thinking…",
		isStreaming: true,
		modeId: "build",
		diffInsertions: 0,
		diffDeletions: 0,
		errorText: null,
		todoProgress: null,
		taskCard: null,
		latestTool: null,
		hasUnseenCompletion: false,
	};

	const demoCardQuestion: KanbanCardData = {
		id: "demo-8",
		title: "Choose the migration runner",
		agentIconSrc: "/svgs/icons/claude.svg",
		agentLabel: "claude",
		projectName: "desktop",
		projectColor: "#22C55E",
		timeAgo: "3m",
		activityText: null,
		isStreaming: false,
		modeId: "plan",
		diffInsertions: 4,
		diffDeletions: 0,
		errorText: null,
		todoProgress: { current: 1, total: 2, label: "Decide" },
		taskCard: null,
		latestTool: null,
		hasUnseenCompletion: false,
	};

	const demoPermissionReq: PermissionRequest = {
		id: "demo-perm-1",
		sessionId: "demo-session",
		permission: "Execute bun test src/lib/utils.test.ts",
		patterns: [],
		metadata: {},
		always: ["Execute"],
	};

	const demoPermissionFileReq: PermissionRequest = {
		id: "demo-perm-2",
		sessionId: "demo-session",
		permission: "Edit src/lib/auth.ts",
		patterns: [],
		metadata: {},
		always: [],
	};

	const demoQuestion: ActivityEntryQuestion = {
		question: "Which test runner do you prefer?",
		multiSelect: false,
		options: [
			{ label: "Vitest" },
			{ label: "Jest" },
			{ label: "Bun" },
		],
	};
	const demoQuestionOptions: readonly ActivityEntryQuestionOption[] = [
		{ label: "Vitest", selected: true, color: "#22C55E" },
		{ label: "Jest", selected: false, color: "#9858FF" },
		{ label: "Bun", selected: false, color: "#FF8D20" },
	];
	const demoQuestionProgress: readonly ActivityEntryQuestionProgress[] = [
		{ questionIndex: 0, answered: true },
	];
	const demoTaskToolCalls: AnyAgentEntry[] = [
		{ id: "t1", type: "tool_call", kind: "read", title: "Read", filePath: "src/lib/auth.ts", status: "done" },
		{ id: "t2", type: "tool_call", kind: "search", title: "Search", subtitle: "user session handler", status: "done" },
		{ id: "t3", type: "tool_call", kind: "edit", title: "Edit", filePath: "src/lib/session.ts", status: "done" },
		{ id: "t4", type: "tool_call", kind: "execute", title: "Execute", subtitle: "bun test", status: "done" },
		{ id: "t5", type: "tool_call", kind: "edit", title: "Edit", filePath: "src/lib/auth.ts", status: "running" },
	];

	let activeSection = $state("button");

	const purpleColor = "#9858FF";
	const redColor = "#FF5D5A";
	const greenColor = "var(--success)";

	function close() {
		onOpenChange(false);
	}

	function handleBackdropClick(event: MouseEvent) {
		if (event.target === event.currentTarget) {
			close();
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === "Escape") {
			event.stopPropagation();
			close();
		}
	}

	function handleShowcaseCardAction(): void {}

	const kanbanMenuTriggerClass =
		"shrink-0 inline-flex h-3 w-4 items-center justify-center text-muted-foreground/55 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:text-foreground";
</script>

{#if open}
	<div
		class="fixed inset-0 z-[var(--app-modal-z)] flex items-center justify-center bg-black/55 p-2 sm:p-4 md:p-5"
		role="dialog"
		aria-modal="true"
		aria-label="Design System"
		tabindex="-1"
		onclick={handleBackdropClick}
		onkeydown={handleKeydown}
	>
		<div
			class="mx-auto flex h-full max-h-[820px] w-full max-w-[860px] flex-col overflow-hidden rounded-xl border border-border/60 bg-background shadow-[0_30px_80px_rgba(0,0,0,0.5)]"
		>
			<!-- Top bar -->
			<EmbeddedPanelHeader>
				<HeaderTitleCell>
					<Palette size={14} weight="fill" class="shrink-0 mr-1.5 text-muted-foreground" />
					<span class="text-[11px] font-semibold font-mono text-foreground select-none truncate leading-none">
						Design System
					</span>
				</HeaderTitleCell>
				<HeaderActionCell>
					<CloseAction onClose={close} title="Close" />
				</HeaderActionCell>
			</EmbeddedPanelHeader>

			<!-- Sidebar + Content -->
			<div class="flex flex-1 min-h-0">
				<!-- Sidebar -->
				<div class="ds-sidebar flex w-[180px] shrink-0 flex-col border-r border-border/50 bg-background">
					<div class="px-2 pt-2 pb-1">
						<span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 px-1.5">
							Components
						</span>
					</div>
					<nav class="flex flex-col gap-0.5 px-2 pb-2">
						{#each sidebarItems as item (item.id)}
							<button
								type="button"
								class="ds-sidebar-item {activeSection === item.id ? 'active' : ''}"
								onclick={() => { activeSection = item.id; }}
							>
							{#if item.icon === "kanban"}
								<Kanban size={12} weight="fill" class="shrink-0" style="color: {purpleColor}" />
							{:else if item.icon === "palette"}
								<Palette size={12} weight="fill" class="shrink-0" style="color: {purpleColor}" />
							{:else if item.icon === "tag"}
								<Tag size={12} weight="fill" class="shrink-0" style="color: {purpleColor}" />
							{:else if item.icon === "robot"}
								<Robot size={12} weight="fill" class="shrink-0" style="color: #18D6C3" />
							{:else if item.icon === "panel"}
								<Rows size={12} weight="fill" class="shrink-0" style="color: {purpleColor}" />
							{:else}
								<ShieldWarning size={12} weight="fill" class="shrink-0" style="color: {purpleColor}" />
							{/if}
								<span>{item.label}</span>
							</button>
						{/each}
					</nav>
				</div>

				<!-- Content -->
				<div class="flex-1 min-w-0 overflow-y-auto bg-accent/20">
					<div class="px-8 py-6">
						{#if activeSection === "button"}
							<div class="mb-1 text-xs font-semibold text-foreground/80">Buttons</div>
							<p class="mb-6 max-w-[420px] text-[11px] text-muted-foreground/60">
								Shared button variants used across headers, toolbars, confirmations, and destructive flows.
							</p>

							<div class="flex flex-col gap-6">
								<div>
									<div class="mb-2 text-[10px] font-mono font-medium uppercase tracking-wider text-muted-foreground/40">
										Core Variants
									</div>
									<div class="ds-specimen flex flex-wrap items-center gap-2">
										<Button>Primary Action</Button>
										<Button variant="secondary">Secondary</Button>
										<Button variant="outline">Outline</Button>
										<Button variant="ghost">Ghost</Button>
										<Button variant="destructive">Delete</Button>
									</div>
								</div>

								<div>
									<div class="mb-2 text-[10px] font-mono font-medium uppercase tracking-wider text-muted-foreground/40">
										Compact Shell Actions
									</div>
									<div class="grid gap-3 md:grid-cols-2">
										<div class="ds-specimen flex items-center gap-2">
									<Button variant="header" size="header">
										<Palette weight="fill" class="size-3.5" />
										<span>Header Action</span>
									</Button>
											<Button variant="header" size="header" disabled={true}>
												<span>Disabled</span>
											</Button>
										</div>
										<div class="ds-specimen flex items-center gap-1">
											<Button variant="toolbar" size="toolbar">
												<XCircle weight="fill" class="size-3 shrink-0" style="color: {redColor}" />
												<span>Deny</span>
											</Button>
											<Button variant="toolbar" size="toolbar">
												<CheckCircle weight="fill" class="size-3 shrink-0" style="color: {greenColor}" />
												<span>Allow</span>
											</Button>
									<Button variant="toolbar" size="toolbar">
										<ShieldCheck weight="fill" class="size-3 shrink-0" style="color: {purpleColor}" />
										<span>Always Allow</span>
									</Button>
								</div>
								<div class="ds-specimen flex items-center gap-2 md:col-span-2">
							<Button variant="header" size="header">
								<Robot weight="fill" class="size-3 shrink-0" style="color: {purpleColor}" />
								<span>New Agent</span>
							</Button>
							<Button variant="header" size="header">
								<span>Update</span>
							</Button>
							<Button variant="header" size="header" disabled={true}>
								<span>Updating</span>
							</Button>
								</div>
							</div>
						</div>

								<div>
									<div class="mb-2 text-[10px] font-mono font-medium uppercase tracking-wider text-muted-foreground/40">
										State Coverage
									</div>
									<div class="ds-specimen flex flex-wrap items-center gap-2">
										<Button size="sm">Small</Button>
										<Button href="https://example.com">Link Button</Button>
										<Button disabled={true}>Disabled</Button>
									</div>
								</div>
							</div>
						{:else if activeSection === "badges"}
							<div class="mb-1 text-xs font-semibold text-foreground/80">Badges &amp; Chips</div>
							<p class="mb-6 max-w-[420px] text-[11px] text-muted-foreground/60">
								Inline indicators for files, git references, projects, diffs, and input artefacts.
							</p>

							<div class="flex flex-col gap-6">
								<!-- File Path Badge -->
								<div>
									<div class="mb-2 text-[10px] font-mono font-medium uppercase tracking-wider text-muted-foreground/40">
										File Path Badge
									</div>
									<div class="ds-specimen flex flex-wrap items-center gap-2">
										<FilePathBadge filePath="src/lib/utils.ts" interactive={false} />
										<FilePathBadge filePath="packages/ui/src/index.ts" linesAdded={12} linesRemoved={3} interactive={false} />
										<FilePathBadge filePath="README.md" interactive={false} size="sm" />
										<FilePathBadge filePath="src/app.svelte" selected={true} interactive={false} />
									</div>
								</div>

								<!-- GitHub Badge -->
								<div>
									<div class="mb-2 text-[10px] font-mono font-medium uppercase tracking-wider text-muted-foreground/40">
										GitHub Badge
									</div>
									<div class="ds-specimen flex flex-wrap items-center gap-2">
										<GitHubBadge ref={{ type: "pr", owner: "flazouh", repo: "acepe", number: 42 }} prState="open" />
										<GitHubBadge ref={{ type: "pr", owner: "flazouh", repo: "acepe", number: 38 }} prState="merged" insertions={84} deletions={12} />
										<GitHubBadge ref={{ type: "pr", owner: "flazouh", repo: "acepe", number: 15 }} prState="closed" />
										<GitHubBadge ref={{ type: "commit", sha: "a1b2c3d" }} />
										<GitHubBadge ref={{ type: "commit", sha: "e4f5a6b" }} insertions={7} deletions={2} />
										<GitHubBadge ref={{ type: "pr", owner: "flazouh", repo: "acepe", number: 99 }} loading={true} />
									</div>
								</div>

								<!-- Git Branch Badge -->
								<div>
									<div class="mb-2 text-[10px] font-mono font-medium uppercase tracking-wider text-muted-foreground/40">
										Git Branch Badge
									</div>
									<div class="ds-specimen flex flex-wrap items-center gap-2">
										<GitBranchBadge branch="main" />
										<GitBranchBadge branch="feat/design-system-badges" />
									</div>
								</div>

								<!-- Project Letter Badge -->
								<div>
									<div class="mb-2 text-[10px] font-mono font-medium uppercase tracking-wider text-muted-foreground/40">
										Project Letter Badge
									</div>
									<div class="ds-specimen flex flex-wrap items-center gap-3">
										<div class="flex items-center gap-1.5">
											<ProjectLetterBadge name="Acepe" color="#3178c6" />
											<span class="text-[11px] text-muted-foreground">Default</span>
										</div>
										<div class="flex items-center gap-1.5">
											<ProjectLetterBadge name="Desktop" color="#ff3e00" />
											<span class="text-[11px] text-muted-foreground">Svelte</span>
										</div>
										<div class="flex items-center gap-1.5">
											<ProjectLetterBadge name="Web" color={purpleColor} size={16} />
											<span class="text-[11px] text-muted-foreground">sm</span>
										</div>
										<div class="flex items-center gap-1.5">
											<ProjectLetterBadge name="UI" color="#f9c396" size={28} />
											<span class="text-[11px] text-muted-foreground">lg</span>
										</div>
									</div>
								</div>

								<!-- Diff Pill -->
								<div>
									<div class="mb-2 text-[10px] font-mono font-medium uppercase tracking-wider text-muted-foreground/40">
										Diff Pill
									</div>
									<div class="ds-specimen flex flex-wrap items-center gap-3">
										<div class="flex items-center gap-1.5">
											<DiffPill insertions={42} deletions={8} />
											<span class="text-[10px] text-muted-foreground">pill</span>
										</div>
										<div class="flex items-center gap-1.5">
											<DiffPill insertions={42} deletions={8} variant="plain" />
											<span class="text-[10px] text-muted-foreground">plain</span>
										</div>
										<div class="flex items-center gap-1.5">
											<DiffPill insertions={7} deletions={0} />
											<span class="text-[10px] text-muted-foreground">add only</span>
										</div>
										<div class="flex items-center gap-1.5">
											<DiffPill insertions={0} deletions={15} />
											<span class="text-[10px] text-muted-foreground">remove only</span>
										</div>
									</div>
								</div>

								<!-- Inline Artefact Badge -->
								<div>
									<div class="mb-2 text-[10px] font-mono font-medium uppercase tracking-wider text-muted-foreground/40">
										Inline Artefact Badge
									</div>
									<div class="ds-specimen flex flex-wrap items-center gap-2">
										<InlineArtefactBadge tokenType="command" label="/plan" value="/plan" />
										<InlineArtefactBadge tokenType="skill" label="ce:work" value="ce:work" />
										<InlineArtefactBadge tokenType="file" label="utils.ts" value="src/lib/utils.ts" />
										<InlineArtefactBadge tokenType="image" label="screenshot.png" value="screenshot.png" />
										<InlineArtefactBadge tokenType="text" label="Selection" value="selected text" charCount={128} />
										<InlineArtefactBadge tokenType="text_ref" label="Clipboard" value="pasted text" charCount={64} />
									</div>
								</div>

								<!-- Pill Button -->
								<div>
									<div class="mb-2 text-[10px] font-mono font-medium uppercase tracking-wider text-muted-foreground/40">
										Pill Button
									</div>
									<div class="ds-specimen flex flex-wrap items-center gap-2">
										<PillButton variant="primary" size="sm">Primary</PillButton>
										<PillButton variant="outline" size="sm">Outline</PillButton>
										<PillButton variant="ghost" size="sm">Ghost</PillButton>
										<PillButton variant="soft" size="sm">Soft</PillButton>
										<PillButton variant="invert" size="sm">Invert</PillButton>
										<PillButton variant="primary" size="xs">XS</PillButton>
										<PillButton variant="primary" disabled={true} size="sm">Disabled</PillButton>
									</div>
								</div>
							</div>

						{:else if activeSection === "panel-header"}
							<div class="mb-1 text-xs font-semibold text-foreground/80">Panel Header</div>
							<p class="mb-6 max-w-[420px] text-[11px] text-muted-foreground/60">
								Embedded panel header with h-7 height, border-b, and action cells. Used in every card and overlay.
							</p>

							<div class="flex flex-col gap-6">
								<!-- Example header with content -->
								<div>
									<div class="mb-2 text-[10px] font-mono font-medium uppercase tracking-wider text-muted-foreground/40">
										Header with Content Area
									</div>
									<div class="ds-specimen overflow-hidden !p-0">
										<EmbeddedPanelHeader>
											<HeaderCell withDivider={false}>
												<span class="size-3 rounded-sm bg-primary"></span>
											</HeaderCell>
											<HeaderTitleCell>
												<span class="text-[11px] font-semibold font-mono text-foreground/80">Example Header</span>
											</HeaderTitleCell>
											<HeaderActionCell withDivider={false}>
												<EmbeddedIconButton title="Action" ariaLabel="Action">
													<X class="size-4" />
												</EmbeddedIconButton>
											</HeaderActionCell>
										</EmbeddedPanelHeader>
										<div class="p-3 text-[11px] text-muted-foreground">
											Panel content area
										</div>
									</div>
								</div>

								<!-- Embedded Icon Button states -->
								<div>
									<div class="mb-2 text-[10px] font-mono font-medium uppercase tracking-wider text-muted-foreground/40">
										Embedded Icon Buttons
									</div>
									<div class="ds-specimen flex items-center gap-0.5">
										<EmbeddedIconButton title="Default" ariaLabel="Default">
											<X class="size-4" />
										</EmbeddedIconButton>
										<EmbeddedIconButton title="Active" ariaLabel="Active" active={true}>
											<X class="size-4" />
										</EmbeddedIconButton>
										<EmbeddedIconButton title="Disabled" ariaLabel="Disabled" disabled={true}>
											<X class="size-4" />
										</EmbeddedIconButton>
									</div>
								</div>
							</div>

						{:else if activeSection === "kanban-card"}
							<div class="mb-1 text-xs font-semibold text-foreground/80">Kanban Card</div>
							<p class="mb-6 max-w-[420px] text-[11px] text-muted-foreground/60">
								Rebuilt from the inside out: first the small header and footer building blocks, then full kanban cards across the states the desktop app actually needs to render.
							</p>

							<div class="flex flex-col gap-8">
								<div>
									<div class="mb-2 text-[10px] font-mono font-medium uppercase tracking-wider text-muted-foreground/40">
										Header Anatomy
									</div>
									<div class="grid gap-4 lg:grid-cols-2">
										<div class="ds-specimen mx-auto w-full max-w-[320px] p-2">
											<div class="overflow-hidden rounded-sm border border-border/60 bg-accent/30">
												<EmbeddedPanelHeader class="bg-card/50">
													<HeaderCell withDivider={false}>
														<ProjectLetterBadge name={demoCardBase.projectName} color={demoCardBase.projectColor} size={14} class="shrink-0" />
													</HeaderCell>
													<HeaderCell>
														<img src={demoCardBase.agentIconSrc} alt={demoCardBase.agentLabel} width="14" height="14" class="shrink-0 rounded-sm" />
													</HeaderCell>
													<HeaderTitleCell compactPadding>
														<div class="flex min-w-0 flex-1 items-center justify-end gap-1.5">
															<span class="shrink-0 font-mono text-[10px] text-muted-foreground/70">{demoCardBase.timeAgo}</span>
														</div>
													</HeaderTitleCell>
													<HeaderActionCell withDivider={true}>
														<div class="flex h-7 items-center justify-center px-1">
															<DiffPill insertions={demoCardBase.diffInsertions} deletions={demoCardBase.diffDeletions} variant="plain" class="text-[10px]" />
														</div>
													</HeaderActionCell>
													<HeaderActionCell withDivider={true}>
														<DropdownMenu.Root>
															<DropdownMenu.Trigger
																class={kanbanMenuTriggerClass}
																aria-label="More actions"
																title="More actions"
															>
																<IconDotsVertical class="h-2.5 w-2.5" aria-hidden="true" />
															</DropdownMenu.Trigger>
															<DropdownMenu.Content align="end" class="min-w-[160px]">
																<DropdownMenu.Item class="cursor-pointer">Example action</DropdownMenu.Item>
															</DropdownMenu.Content>
														</DropdownMenu.Root>
													</HeaderActionCell>
													<HeaderActionCell withDivider={false}>
														<EmbeddedIconButton title="Close" ariaLabel="Close" class="border-l border-border/40">
															<X class="size-3" />
														</EmbeddedIconButton>
													</HeaderActionCell>
												</EmbeddedPanelHeader>
												<div class="px-1.5 py-1">
													<span class="block text-xs font-medium leading-tight text-foreground">{demoCardBase.title}</span>
												</div>
											</div>
										</div>
										<div class="ds-specimen mx-auto flex w-full max-w-[320px] flex-col gap-2 p-2">
											<div class="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/50">
												Title + metadata stack
											</div>
											<div class="overflow-hidden rounded-sm border border-border/60 bg-accent/30 px-1.5 py-1">
												<div class="flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
													<ProjectLetterBadge name={demoCardBase.projectName} color={demoCardBase.projectColor} size={14} class="shrink-0" />
													<span class="font-mono">{demoCardBase.agentLabel}</span>
													<span class="ml-auto font-mono">{demoCardBase.timeAgo}</span>
												</div>
												<div class="mt-1 text-xs font-medium leading-tight text-foreground">
													{demoCardBase.title}
												</div>
											</div>
										</div>
									</div>
								</div>

								<div>
									<div class="mb-2 text-[10px] font-mono font-medium uppercase tracking-wider text-muted-foreground/40">
										Footer Building Blocks
									</div>
									<div class="grid gap-4 lg:grid-cols-2">
										<div class="ds-specimen mx-auto w-full max-w-[320px] p-2">
											<div class="mb-2 text-[10px] font-mono uppercase tracking-wider text-muted-foreground/50">
												Pending permission card
											</div>
											<PermissionBar
												sessionId={demoPermissionReq.sessionId}
												permission={demoPermissionReq}
												projectPath="/Users/alex/Documents/acepe"
											/>
										</div>
										<div class="ds-specimen mx-auto w-full max-w-[320px] p-2">
											<div class="mb-2 text-[10px] font-mono uppercase tracking-wider text-muted-foreground/50">
												Queue question card
											</div>
											<AttentionQueueQuestionCard
												currentQuestion={demoQuestion}
												totalQuestions={1}
												hasMultipleQuestions={false}
												currentQuestionIndex={0}
												questionId="demo-question"
												questionProgress={demoQuestionProgress}
												currentQuestionAnswered={false}
												currentQuestionOptions={demoQuestionOptions}
												otherText=""
												otherPlaceholder="Other"
												showOtherInput={false}
												showSubmitButton={true}
												canSubmit={true}
												submitLabel="Submit"
												onOptionSelect={() => {}}
												onOtherInput={() => {}}
												onOtherKeydown={() => {}}
												onSubmitAll={() => {}}
												onPrevQuestion={() => {}}
												onNextQuestion={() => {}}
											/>
										</div>
									</div>
								</div>

								<div>
									<div class="mb-2 text-[10px] font-mono font-medium uppercase tracking-wider text-muted-foreground/40">
										Full Card States
									</div>
									<div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
										<div>
											<div class="mb-2 text-[10px] font-mono font-medium uppercase tracking-wider text-muted-foreground/40">
												Ready / Todo Progress
											</div>
											<div class="mx-auto w-full max-w-[280px]">
												<KanbanCard card={demoCardBase} onclick={handleShowcaseCardAction} onClose={handleShowcaseCardAction}>
													{#snippet menu()}
														<DropdownMenu.Root>
															<DropdownMenu.Trigger
																class={kanbanMenuTriggerClass}
																aria-label="More actions"
																title="More actions"
																onclick={(event) => event.stopPropagation()}
															>
																<IconDotsVertical class="h-2.5 w-2.5" aria-hidden="true" />
															</DropdownMenu.Trigger>
															<DropdownMenu.Content align="end" class="min-w-[160px]">
																<DropdownMenu.Item class="cursor-pointer">Open session</DropdownMenu.Item>
															</DropdownMenu.Content>
														</DropdownMenu.Root>
													{/snippet}
												</KanbanCard>
											</div>
										</div>
										<div>
											<div class="mb-2 text-[10px] font-mono font-medium uppercase tracking-wider text-muted-foreground/40">
												Planning / Thinking
											</div>
											<div class="mx-auto w-full max-w-[280px]">
												<KanbanCard card={demoCardStreaming} onclick={handleShowcaseCardAction} onClose={handleShowcaseCardAction}>
													{#snippet menu()}
														<DropdownMenu.Root>
															<DropdownMenu.Trigger
																class={kanbanMenuTriggerClass}
																aria-label="More actions"
																title="More actions"
																onclick={(event) => event.stopPropagation()}
															>
																<IconDotsVertical class="h-2.5 w-2.5" aria-hidden="true" />
															</DropdownMenu.Trigger>
															<DropdownMenu.Content align="end" class="min-w-[160px]">
																<DropdownMenu.Item class="cursor-pointer">Open session</DropdownMenu.Item>
															</DropdownMenu.Content>
														</DropdownMenu.Root>
													{/snippet}
												</KanbanCard>
											</div>
										</div>
										<div>
											<div class="mb-2 text-[10px] font-mono font-medium uppercase tracking-wider text-muted-foreground/40">
												Working / Latest Tool
											</div>
											<div class="mx-auto w-full max-w-[280px]">
												<KanbanCard card={demoCardWithTool} onclick={handleShowcaseCardAction} onClose={handleShowcaseCardAction}>
													{#snippet menu()}
														<DropdownMenu.Root>
															<DropdownMenu.Trigger
																class={kanbanMenuTriggerClass}
																aria-label="More actions"
																title="More actions"
																onclick={(event) => event.stopPropagation()}
															>
																<IconDotsVertical class="h-2.5 w-2.5" aria-hidden="true" />
															</DropdownMenu.Trigger>
															<DropdownMenu.Content align="end" class="min-w-[160px]">
																<DropdownMenu.Item class="cursor-pointer">Open session</DropdownMenu.Item>
															</DropdownMenu.Content>
														</DropdownMenu.Root>
													{/snippet}
												</KanbanCard>
											</div>
										</div>
										<div>
											<div class="mb-2 text-[10px] font-mono font-medium uppercase tracking-wider text-muted-foreground/40">
												Subagent Task
											</div>
											<div class="mx-auto w-full max-w-[280px]">
												<KanbanCard card={demoCardSubagent} onclick={handleShowcaseCardAction} onClose={handleShowcaseCardAction}>
													{#snippet menu()}
														<DropdownMenu.Root>
															<DropdownMenu.Trigger
																class={kanbanMenuTriggerClass}
																aria-label="More actions"
																title="More actions"
																onclick={(event) => event.stopPropagation()}
															>
																<IconDotsVertical class="h-2.5 w-2.5" aria-hidden="true" />
															</DropdownMenu.Trigger>
															<DropdownMenu.Content align="end" class="min-w-[160px]">
																<DropdownMenu.Item class="cursor-pointer">Open session</DropdownMenu.Item>
															</DropdownMenu.Content>
														</DropdownMenu.Root>
													{/snippet}
												</KanbanCard>
											</div>
										</div>
										<div>
											<div class="mb-2 text-[10px] font-mono font-medium uppercase tracking-wider text-muted-foreground/40">
												Multi-Subagent Task
											</div>
											<div class="mx-auto w-full max-w-[280px]">
												<KanbanCard card={demoCardMultiSubagent} onclick={handleShowcaseCardAction} onClose={handleShowcaseCardAction}>
													{#snippet menu()}
														<DropdownMenu.Root>
															<DropdownMenu.Trigger
																class={kanbanMenuTriggerClass}
																aria-label="More actions"
																title="More actions"
																onclick={(event) => event.stopPropagation()}
															>
																<IconDotsVertical class="h-2.5 w-2.5" aria-hidden="true" />
															</DropdownMenu.Trigger>
															<DropdownMenu.Content align="end" class="min-w-[160px]">
																<DropdownMenu.Item class="cursor-pointer">Open session</DropdownMenu.Item>
															</DropdownMenu.Content>
														</DropdownMenu.Root>
													{/snippet}
												</KanbanCard>
											</div>
										</div>
										<div>
											<div class="mb-2 text-[10px] font-mono font-medium uppercase tracking-wider text-muted-foreground/40">
												Review / Unread Completion
											</div>
											<div class="mx-auto w-full max-w-[280px]">
												<KanbanCard card={demoCardNeedsReview} onclick={handleShowcaseCardAction} onClose={handleShowcaseCardAction}>
													{#snippet menu()}
														<DropdownMenu.Root>
															<DropdownMenu.Trigger
																class={kanbanMenuTriggerClass}
																aria-label="More actions"
																title="More actions"
																onclick={(event) => event.stopPropagation()}
															>
																<IconDotsVertical class="h-2.5 w-2.5" aria-hidden="true" />
															</DropdownMenu.Trigger>
															<DropdownMenu.Content align="end" class="min-w-[160px]">
																<DropdownMenu.Item class="cursor-pointer">Open session</DropdownMenu.Item>
															</DropdownMenu.Content>
														</DropdownMenu.Root>
													{/snippet}
												</KanbanCard>
											</div>
										</div>
										<div>
											<div class="mb-2 text-[10px] font-mono font-medium uppercase tracking-wider text-muted-foreground/40">
												Error State
											</div>
											<div class="mx-auto w-full max-w-[280px]">
												<KanbanCard card={demoCardError} onclick={handleShowcaseCardAction} onClose={handleShowcaseCardAction}>
													{#snippet menu()}
														<DropdownMenu.Root>
															<DropdownMenu.Trigger
																class={kanbanMenuTriggerClass}
																aria-label="More actions"
																title="More actions"
																onclick={(event) => event.stopPropagation()}
															>
																<IconDotsVertical class="h-2.5 w-2.5" aria-hidden="true" />
															</DropdownMenu.Trigger>
															<DropdownMenu.Content align="end" class="min-w-[160px]">
																<DropdownMenu.Item class="cursor-pointer">Open session</DropdownMenu.Item>
															</DropdownMenu.Content>
														</DropdownMenu.Root>
													{/snippet}
												</KanbanCard>
											</div>
										</div>
										<div>
											<div class="mb-2 text-[10px] font-mono font-medium uppercase tracking-wider text-muted-foreground/40">
												Permission Required
											</div>
											<div class="mx-auto w-full max-w-[280px]">
												<KanbanCard card={demoCardPermission} onclick={handleShowcaseCardAction} onClose={handleShowcaseCardAction} showFooter={true}>
													{#snippet menu()}
														<DropdownMenu.Root>
															<DropdownMenu.Trigger
																class={kanbanMenuTriggerClass}
																aria-label="More actions"
																title="More actions"
																onclick={(event) => event.stopPropagation()}
															>
																<IconDotsVertical class="h-2.5 w-2.5" aria-hidden="true" />
															</DropdownMenu.Trigger>
															<DropdownMenu.Content align="end" class="min-w-[160px]">
																<DropdownMenu.Item class="cursor-pointer">Open session</DropdownMenu.Item>
															</DropdownMenu.Content>
														</DropdownMenu.Root>
													{/snippet}
													{#snippet footer()}
														<PermissionBar
															sessionId={demoPermissionFileReq.sessionId}
															permission={demoPermissionFileReq}
															projectPath="/Users/alex/Documents/acepe"
														/>
													{/snippet}
												</KanbanCard>
											</div>
										</div>
										<div>
											<div class="mb-2 text-[10px] font-mono font-medium uppercase tracking-wider text-muted-foreground/40">
												Question Required
											</div>
											<div class="mx-auto w-full max-w-[280px]">
												<KanbanCard card={demoCardQuestion} onclick={handleShowcaseCardAction} onClose={handleShowcaseCardAction} showFooter={true}>
													{#snippet menu()}
														<DropdownMenu.Root>
															<DropdownMenu.Trigger
																class={kanbanMenuTriggerClass}
																aria-label="More actions"
																title="More actions"
																onclick={(event) => event.stopPropagation()}
															>
																<IconDotsVertical class="h-2.5 w-2.5" aria-hidden="true" />
															</DropdownMenu.Trigger>
															<DropdownMenu.Content align="end" class="min-w-[160px]">
																<DropdownMenu.Item class="cursor-pointer">Open session</DropdownMenu.Item>
															</DropdownMenu.Content>
														</DropdownMenu.Root>
													{/snippet}
													{#snippet todoSection()}
														<div class="flex items-center justify-between px-1.5 py-1 text-[10px] font-mono text-muted-foreground">
															<span>Todo Header</span>
															<span>1/2</span>
														</div>
													{/snippet}
													{#snippet footer()}
														<AttentionQueueQuestionCard
															currentQuestion={demoQuestion}
															totalQuestions={1}
															hasMultipleQuestions={false}
															currentQuestionIndex={0}
															questionId="demo-question"
															questionProgress={demoQuestionProgress}
															currentQuestionAnswered={false}
															currentQuestionOptions={demoQuestionOptions}
															otherText=""
															otherPlaceholder="Other"
															showOtherInput={false}
															showSubmitButton={true}
															canSubmit={true}
															submitLabel="Submit"
															onOptionSelect={() => {}}
															onOtherInput={() => {}}
															onOtherKeydown={() => {}}
															onSubmitAll={() => {}}
															onPrevQuestion={() => {}}
															onNextQuestion={() => {}}
														/>
													{/snippet}
												</KanbanCard>
											</div>
										</div>
									</div>
								</div>
							</div>

						{:else if activeSection === "agent-tool-task"}
						<div class="mb-1 text-xs font-semibold text-foreground/80">Agent Tool Task</div>
						<p class="mb-6 max-w-[420px] text-[11px] text-muted-foreground/60">
							Subagent task card used in the agent panel. Shows description, prompt, result, tool call tally, and last tool row. Supports compact mode for kanban embedding.
						</p>

						<div class="flex flex-col gap-6">
							<!-- Default: running with children -->
							<div>
								<div class="mb-2 text-[10px] font-mono font-medium uppercase tracking-wider text-muted-foreground/40">
									Default — Running
								</div>
								<div class="mx-auto w-full max-w-[400px]">
									<AgentToolTask
										description="Refactor auth session handling"
										prompt="Investigate the session timeout bug in auth.ts and fix the race condition when multiple tabs refresh tokens simultaneously."
										children={demoTaskToolCalls}
										status="running"
										iconBasePath="/svgs/icons"
									/>
								</div>
							</div>

							<!-- Default: done with result -->
							<div>
								<div class="mb-2 text-[10px] font-mono font-medium uppercase tracking-wider text-muted-foreground/40">
									Default — Done with Result
								</div>
								<div class="mx-auto w-full max-w-[400px]">
									<AgentToolTask
										description="Fix session timeout race condition"
										prompt="Investigate the session timeout bug in auth.ts and fix the race condition."
										resultText="Fixed the race condition by adding a mutex lock around the token refresh. Added a test to verify concurrent refresh requests are serialized correctly."
										children={demoTaskToolCalls}
										status="done"
										showDoneIcon={true}
										durationLabel="12s"
										iconBasePath="/svgs/icons"
									/>
								</div>
							</div>

							<!-- Compact: running -->
							<div>
								<div class="mb-2 text-[10px] font-mono font-medium uppercase tracking-wider text-muted-foreground/40">
									Compact — Running
								</div>
								<div class="mx-auto w-full max-w-[260px]">
									<AgentToolTask
										description="Refactor auth session handling"
										children={demoTaskToolCalls}
										status="running"
										compact={true}
										iconBasePath="/svgs/icons"
									/>
								</div>
							</div>

							<!-- Compact: done -->
							<div>
								<div class="mb-2 text-[10px] font-mono font-medium uppercase tracking-wider text-muted-foreground/40">
									Compact — Done
								</div>
								<div class="mx-auto w-full max-w-[260px]">
									<AgentToolTask
										description="Fix session timeout race condition"
										resultText="Fixed the race condition by adding a mutex lock around the token refresh."
										children={demoTaskToolCalls}
										status="done"
										showDoneIcon={true}
										compact={true}
										durationLabel="12s"
										iconBasePath="/svgs/icons"
									/>
								</div>
							</div>

							<!-- Compact: no children (pending) -->
							<div>
								<div class="mb-2 text-[10px] font-mono font-medium uppercase tracking-wider text-muted-foreground/40">
									Compact — Pending (no tools yet)
								</div>
								<div class="mx-auto w-full max-w-[260px]">
									<AgentToolTask
										description="Analyze test coverage gaps"
										children={[]}
										status="pending"
										compact={true}
										iconBasePath="/svgs/icons"
									/>
								</div>
							</div>
						</div>

					{:else if activeSection === "permission-card"}
							<div class="mb-1 text-xs font-semibold text-foreground/80">Permission Card</div>
							<p class="mb-6 text-[11px] text-muted-foreground/60 max-w-[420px]">
								Compact card above the composer. Header shows tool kind + segmented progress (current segment highlighted). Command wraps naturally. Full-width toolbar buttons.
							</p>

							<div class="flex flex-col gap-6">
								<!-- Variant: Execute command (1st of 3) -->
								<div>
									<div class="mb-2 text-[10px] font-mono font-medium uppercase tracking-wider text-muted-foreground/40">
										Execute — 1st of 3 (current highlighted)
									</div>
									<div class="mx-auto w-full max-w-[320px]">
										<div class="flex min-w-0 flex-col gap-1 overflow-hidden rounded-sm border border-border/60 bg-accent/30 px-1.5 py-1">
											<div class="flex min-w-0 items-center gap-1.5">
												<ShieldWarning weight="fill" size={10} class="shrink-0" style="color: {purpleColor}" />
												<span class="text-[10px] font-mono font-medium text-muted-foreground">Execute</span>
												<div class="shrink-0 ml-auto">
													<VoiceDownloadProgress ariaLabel="Permission 1 of 3" compact={true} label="" percent={33} segmentCount={3} showPercent={false} />
												</div>
											</div>
											<div class="rounded-sm bg-accent/40 px-2 py-1">
												<code class="block font-mono text-[10px] text-foreground/70 whitespace-pre-wrap break-words">$ bun test src/lib/utils.test.ts</code>
											</div>
											<div class="flex w-full items-center gap-1">
												<Button variant="toolbar" size="toolbar" class="flex-1 justify-center">
													<XCircle weight="fill" class="size-3 shrink-0" style="color: {redColor}" />
													<span>Deny</span>
												</Button>
												<Button variant="toolbar" size="toolbar" class="flex-1 justify-center">
													<CheckCircle weight="fill" class="size-3 shrink-0" style="color: {greenColor}" />
													<span>Allow</span>
												</Button>
												<Button variant="toolbar" size="toolbar" class="flex-1 justify-center">
													<ShieldCheck weight="fill" class="size-3 shrink-0" style="color: {purpleColor}" />
													<span>Always Allow</span>
												</Button>
											</div>
										</div>
									</div>
								</div>

								<!-- Variant: Edit — 2nd of 2 (file path in header) -->
								<div>
									<div class="mb-2 text-[10px] font-mono font-medium uppercase tracking-wider text-muted-foreground/40">
										Edit — file path in header
									</div>
									<div class="mx-auto w-full max-w-[320px]">
										<div class="flex min-w-0 flex-col gap-1 overflow-hidden rounded-sm border border-border/60 bg-accent/30 px-1.5 py-1">
											<div class="flex min-w-0 items-center gap-1.5">
												<ShieldWarning weight="fill" size={10} class="shrink-0" style="color: {purpleColor}" />
												<span class="text-[10px] font-mono font-medium text-muted-foreground shrink-0">Edit</span>
												<div class="min-w-0 flex-1">
													<FilePathBadge filePath="packages/ui/src/index.ts" interactive={false} size="sm" />
												</div>
												<div class="shrink-0 ml-auto">
													<VoiceDownloadProgress ariaLabel="Permission 2 of 2" compact={true} label="" percent={100} segmentCount={2} showPercent={false} />
												</div>
											</div>
											<div class="flex w-full items-center gap-1">
												<Button variant="toolbar" size="toolbar" class="flex-1 justify-center">
													<XCircle weight="fill" class="size-3 shrink-0" style="color: {redColor}" />
													<span>Deny</span>
												</Button>
												<Button variant="toolbar" size="toolbar" class="flex-1 justify-center">
													<CheckCircle weight="fill" class="size-3 shrink-0" style="color: {greenColor}" />
													<span>Allow</span>
												</Button>
											</div>
										</div>
									</div>
								</div>

								<!-- Variant: Long command wrapping -->
								<div>
									<div class="mb-2 text-[10px] font-mono font-medium uppercase tracking-wider text-muted-foreground/40">
										Long Command (wrapping)
									</div>
									<div class="mx-auto w-full max-w-[320px]">
										<div class="flex min-w-0 flex-col gap-1 overflow-hidden rounded-sm border border-border/60 bg-accent/30 px-1.5 py-1">
											<div class="flex min-w-0 items-center gap-1.5">
												<ShieldWarning weight="fill" size={10} class="shrink-0" style="color: {purpleColor}" />
												<span class="text-[10px] font-mono font-medium text-muted-foreground">Execute</span>
												<div class="shrink-0 ml-auto">
													<VoiceDownloadProgress ariaLabel="Permission 3 of 5" compact={true} label="" percent={60} segmentCount={5} showPercent={false} />
												</div>
											</div>
											<div class="max-h-[72px] overflow-y-auto rounded-sm bg-accent/40 px-2 py-1">
												<code class="block font-mono text-[10px] text-foreground/70 whitespace-pre-wrap break-words">$ RUST_BACKTRACE=1 cargo test --lib crate::acp::parsers::claude_code_parser::tests::test_infer_tool_kind -- --nocapture</code>
											</div>
											<div class="flex w-full items-center gap-1">
												<Button variant="toolbar" size="toolbar" class="flex-1 justify-center">
													<XCircle weight="fill" class="size-3 shrink-0" style="color: {redColor}" />
													<span>Deny</span>
												</Button>
												<Button variant="toolbar" size="toolbar" class="flex-1 justify-center">
													<CheckCircle weight="fill" class="size-3 shrink-0" style="color: {greenColor}" />
													<span>Allow</span>
												</Button>
												<Button variant="toolbar" size="toolbar" class="flex-1 justify-center">
													<ShieldCheck weight="fill" class="size-3 shrink-0" style="color: {purpleColor}" />
													<span>Always Allow</span>
												</Button>
											</div>
										</div>
									</div>
								</div>

								<!-- Variant: Single permission (no progress bar) -->
								<div>
									<div class="mb-2 text-[10px] font-mono font-medium uppercase tracking-wider text-muted-foreground/40">
										Single Permission (1 of 1)
									</div>
									<div class="mx-auto w-full max-w-[320px]">
										<div class="flex min-w-0 flex-col gap-1 overflow-hidden rounded-sm border border-border/60 bg-accent/30 px-1.5 py-1">
											<div class="flex min-w-0 items-center gap-1.5">
												<ShieldWarning weight="fill" size={10} class="shrink-0" style="color: {purpleColor}" />
												<span class="text-[10px] font-mono font-medium text-muted-foreground">Read</span>
												<div class="shrink-0 ml-auto">
													<VoiceDownloadProgress ariaLabel="Permission 1 of 1" compact={true} label="" percent={100} segmentCount={1} showPercent={false} />
												</div>
											</div>
											<div class="flex w-full items-center gap-1">
												<Button variant="toolbar" size="toolbar" class="flex-1 justify-center">
													<XCircle weight="fill" class="size-3 shrink-0" style="color: {redColor}" />
													<span>Deny</span>
												</Button>
												<Button variant="toolbar" size="toolbar" class="flex-1 justify-center">
													<CheckCircle weight="fill" class="size-3 shrink-0" style="color: {greenColor}" />
													<span>Allow</span>
												</Button>
												<Button variant="toolbar" size="toolbar" class="flex-1 justify-center">
													<ShieldCheck weight="fill" class="size-3 shrink-0" style="color: {purpleColor}" />
													<span>Always Allow</span>
												</Button>
											</div>
										</div>
									</div>
								</div>

								<!-- Toolbar Buttons isolation -->
								<div>
									<div class="mb-2 text-[10px] font-mono font-medium uppercase tracking-wider text-muted-foreground/40">
										Toolbar Buttons (new variant)
									</div>
									<div class="ds-specimen">
										<div class="flex items-center gap-1">
											<Button variant="toolbar" size="toolbar" class="flex-1 justify-center">
												<XCircle weight="fill" class="size-3 shrink-0" style="color: {redColor}" />
												<span>Deny</span>
											</Button>
											<Button variant="toolbar" size="toolbar" class="flex-1 justify-center">
												<CheckCircle weight="fill" class="size-3 shrink-0" style="color: {greenColor}" />
												<span>Allow</span>
											</Button>
											<Button variant="toolbar" size="toolbar" class="flex-1 justify-center">
												<ShieldCheck weight="fill" class="size-3 shrink-0" style="color: {purpleColor}" />
												<span>Always Allow</span>
											</Button>
										</div>
									</div>
								</div>

								<!-- Segmented Progress -->
								<div>
									<div class="mb-2 text-[10px] font-mono font-medium uppercase tracking-wider text-muted-foreground/40">
										Segmented Progress (current highlighted)
									</div>
									<div class="ds-specimen">
										<div class="flex flex-col gap-3">
											<div class="flex items-center gap-3">
												<span class="text-[10px] font-mono text-muted-foreground/50 w-14 shrink-0">1 of 3</span>
												<VoiceDownloadProgress ariaLabel="1 of 3" compact={true} label="" percent={33} segmentCount={3} showPercent={false} />
											</div>
											<div class="flex items-center gap-3">
												<span class="text-[10px] font-mono text-muted-foreground/50 w-14 shrink-0">2 of 3</span>
												<VoiceDownloadProgress ariaLabel="2 of 3" compact={true} label="" percent={66} segmentCount={3} showPercent={false} />
											</div>
											<div class="flex items-center gap-3">
												<span class="text-[10px] font-mono text-muted-foreground/50 w-14 shrink-0">3 of 3</span>
												<VoiceDownloadProgress ariaLabel="3 of 3" compact={true} label="" percent={100} segmentCount={3} showPercent={false} />
											</div>
											<div class="flex items-center gap-3">
												<span class="text-[10px] font-mono text-muted-foreground/50 w-14 shrink-0">3 of 8</span>
												<VoiceDownloadProgress ariaLabel="3 of 8" compact={true} label="" percent={37} segmentCount={8} showPercent={false} />
											</div>
										</div>
									</div>
								</div>
							</div>
						{/if}
					</div>
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	.ds-sidebar-item {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 8px;
		font: inherit;
		font-size: 0.6875rem;
		color: var(--muted-foreground);
		background: transparent;
		border: none;
		border-radius: 6px;
		cursor: pointer;
		text-align: left;
		transition: background 0.12s ease, color 0.12s ease;
	}

	.ds-sidebar-item:hover {
		background: color-mix(in srgb, var(--accent) 50%, transparent);
		color: var(--foreground);
	}

	.ds-sidebar-item.active {
		background: var(--accent);
		color: var(--foreground);
	}

	.ds-specimen {
		border-radius: 6px;
		border: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
		background: color-mix(in srgb, var(--accent) 30%, transparent);
		padding: 12px;
	}
</style>
