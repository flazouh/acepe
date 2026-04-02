<script lang="ts">
	import VoiceDownloadProgress from "$lib/components/voice-download-progress.svelte";
	import { Button } from "@acepe/ui/button";
	import {
		CloseAction,
		EmbeddedPanelHeader,
		HeaderActionCell,
		HeaderTitleCell,
	} from "@acepe/ui/panel-header";
	import {
		DiffPill,
		FilePathBadge,
		GitBranchBadge,
		GitHubBadge,
		InlineArtefactBadge,
		KanbanCard,
		KanbanQuestionFooter,
		PillButton,
		ProjectLetterBadge,
		type KanbanCardData,
		type KanbanQuestionData,
	} from "@acepe/ui";
	import CheckCircle from "phosphor-svelte/lib/CheckCircle";
	import Kanban from "phosphor-svelte/lib/Kanban";
	import Palette from "phosphor-svelte/lib/Palette";
	import ShieldCheck from "phosphor-svelte/lib/ShieldCheck";
	import ShieldWarning from "phosphor-svelte/lib/ShieldWarning";
	import Tag from "phosphor-svelte/lib/Tag";
	import XCircle from "phosphor-svelte/lib/XCircle";

	import PermissionActionBar from "$lib/acp/components/tool-calls/permission-action-bar.svelte";
	import type { PermissionRequest } from "$lib/acp/types/permission.js";

	interface Props {
		open: boolean;
		onOpenChange: (open: boolean) => void;
	}

	let { open, onOpenChange }: Props = $props();

	type SidebarItem = { id: string; label: string; icon: "palette" | "shield" | "kanban" | "tag" };
	const sidebarItems: SidebarItem[] = [
		{ id: "button", label: "Buttons", icon: "palette" },
		{ id: "badges", label: "Badges & Chips", icon: "tag" },
		{ id: "permission-card", label: "Permission Card", icon: "shield" },
		{ id: "kanban-card", label: "Kanban Card", icon: "kanban" },
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
		todoProgress: { current: 3, total: 5 },
		latestTool: null,
		toolCalls: [],
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
		latestTool: null,
		toolCalls: [],
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
		isStreaming: false,
		modeId: "build",
		diffInsertions: 12,
		diffDeletions: 3,
		errorText: null,
		todoProgress: null,
		latestTool: {
			id: "tool-1",
			kind: "edit",
			title: "Edit",
			filePath: "src/lib/auth.ts",
			status: "done",
		},
		toolCalls: [],
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
		latestTool: null,
		toolCalls: [],
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

	const demoQuestion: KanbanQuestionData = {
		questionText: "Which test runner do you prefer?",
		options: [
			{ label: "Vitest", selected: true },
			{ label: "Jest", selected: false },
			{ label: "Bun", selected: false },
		],
		canSubmit: true,
	};
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
</script>

{#if open}
	<div
		class="fixed inset-0 z-[9997] flex items-center justify-center bg-black/55 p-2 sm:p-4 md:p-5"
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
								<Palette size={12} weight="fill" class="shrink-0" style="color: {purpleColor}" />						{:else if item.icon === "tag"}
							<Tag size={12} weight="fill" class="shrink-0" style="color: {purpleColor}" />							{:else}
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

						{:else if activeSection === "kanban-card"}
							<div class="mb-1 text-xs font-semibold text-foreground/80">Kanban Card</div>
							<p class="mb-6 max-w-[420px] text-[11px] text-muted-foreground/60">
								Compact session card used in the kanban board. Shows robot icon, project badge, agent icon, title, time, tool activity, todo progress, and diff stats. Supports permission and question footer slots.
							</p>

							<div class="flex flex-col gap-6">
								<!-- Basic card with todo + diff -->
								<div>
									<div class="mb-2 text-[10px] font-mono font-medium uppercase tracking-wider text-muted-foreground/40">
										With Todo Progress + Diff
									</div>
									<div class="mx-auto w-full max-w-[260px]">
										<KanbanCard card={demoCardBase} />
									</div>
								</div>

								<!-- Streaming / thinking -->
								<div>
									<div class="mb-2 text-[10px] font-mono font-medium uppercase tracking-wider text-muted-foreground/40">
										Streaming (Thinking)
									</div>
									<div class="mx-auto w-full max-w-[260px]">
										<KanbanCard card={demoCardStreaming} />
									</div>
								</div>

								<!-- With tool row -->
								<div>
									<div class="mb-2 text-[10px] font-mono font-medium uppercase tracking-wider text-muted-foreground/40">
										With Latest Tool
									</div>
									<div class="mx-auto w-full max-w-[260px]">
										<KanbanCard card={demoCardWithTool} />
									</div>
								</div>

								<!-- Error state -->
								<div>
									<div class="mb-2 text-[10px] font-mono font-medium uppercase tracking-wider text-muted-foreground/40">
										Error State
									</div>
									<div class="mx-auto w-full max-w-[260px]">
										<KanbanCard card={demoCardError} />
									</div>
								</div>

								<!-- With permission footer (command + always) -->
								<div>
									<div class="mb-2 text-[10px] font-mono font-medium uppercase tracking-wider text-muted-foreground/40">
										Permission Footer (Command + Always)
									</div>
									<div class="mx-auto w-full max-w-[260px]">
										<KanbanCard card={demoCardStreaming}>
											{#snippet footer()}
												<PermissionActionBar permission={demoPermissionReq} compact />
											{/snippet}
										</KanbanCard>
									</div>
								</div>

								<!-- With permission footer (file, no always) -->
								<div>
									<div class="mb-2 text-[10px] font-mono font-medium uppercase tracking-wider text-muted-foreground/40">
										Permission Footer (File Path)
									</div>
									<div class="mx-auto w-full max-w-[260px]">
										<KanbanCard card={demoCardWithTool}>
											{#snippet footer()}
												<PermissionActionBar permission={demoPermissionFileReq} compact />
											{/snippet}
										</KanbanCard>
									</div>
								</div>

								<!-- With question footer -->
								<div>
									<div class="mb-2 text-[10px] font-mono font-medium uppercase tracking-wider text-muted-foreground/40">
										Question Footer
									</div>
									<div class="mx-auto w-full max-w-[260px]">
										<KanbanCard card={demoCardBase}>
											{#snippet footer()}
												<KanbanQuestionFooter
													question={demoQuestion}
													onSelectOption={() => {}}
													onSubmit={() => {}}
												/>
											{/snippet}
										</KanbanCard>
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
													<FilePathBadge filePath="packages/ui/src/index.ts" iconBasePath="/svgs/icons" interactive={false} size="sm" />
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
