<script lang="ts">
import * as Popover from "$lib/components/ui/popover/index.js";
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import type { PrListItem, RepoContext } from "$lib/acp/types/github-integration.js";
import type {
	SessionLinkedPr,
	SessionPrLinkMode,
} from "$lib/acp/application/dto/session-linked-pr.js";
import type { SessionCold } from "$lib/acp/application/dto/session-cold.js";
import type { Project } from "$lib/acp/logic/project-manager.svelte.js";
import PrStateIcon from "$lib/acp/components/pr-state-icon.svelte";
import { listPullRequests, getRepoContext } from "$lib/acp/services/github-service.js";
import { getSessionStore } from "$lib/acp/store/session-store.svelte.js";
import { Input } from "$lib/components/ui/input/index.js";
import { GitHubBadge, ProjectLetterBadge } from "@acepe/ui";
import { Tooltip } from "bits-ui";
import { LinkSimple } from "phosphor-svelte";
import { toast } from "svelte-sonner";

interface Props {
	sessionId: string;
	projectPath: string;
	linkedPr?: SessionLinkedPr | null;
	prLinkMode?: SessionPrLinkMode | null;
	/** All sessions in the current project, used to surface sessions linked to each PR. */
	projectSessions?: readonly SessionCold[];
	/** Project metadata, used to render the project-letter badge (color, icon). */
	project?: Project | null;
	/** Render mode:
	 * - "footer": standalone tooltip-anchored footer button (legacy)
	 * - "menu": DropdownMenu.Sub trigger inside a parent DropdownMenu
	 * - "header-icon": icon-only button inside a button-group (e.g. modified-files header) */
	variant?: "footer" | "menu" | "header-icon";
}

let {
	sessionId,
	projectPath,
	linkedPr = null,
	prLinkMode = "automatic",
	projectSessions = [],
	project = null,
	variant = "footer",
}: Props = $props();

const sessionStore = getSessionStore();

let anchorRef = $state<HTMLElement | null>(null);
let headerIconRef = $state<HTMLButtonElement | null>(null);
let pickerOpen = $state(false);
let query = $state("");
let loadError = $state<string | null>(null);
let loading = $state(false);
let loadingProjectPath = $state<string | null>(null);
let openPullRequests = $state<readonly PrListItem[]>([]);
let loadedProjectPath = $state<string | null>(null);
let loadedRepoContext = $state<RepoContext | null>(null);

const tooltipLabel = $derived.by(() => {
	if (!linkedPr) return "Link pull request";
	return `#${linkedPr.prNumber}`;
});

/**
 * Map: prNumber → readonly SessionCold[] (sessions in this project already linked to that PR).
 * Built from the sessions list passed in via props.
 */
const sessionsByPrNumber = $derived.by(() => {
	const map = new Map<number, SessionCold[]>();
	for (const s of projectSessions) {
		if (s.prNumber == null) continue;
		let arr = map.get(s.prNumber);
		if (!arr) {
			arr = [];
			map.set(s.prNumber, arr);
		}
		arr.push(s);
	}
	return map;
});

const filteredPullRequests = $derived.by(() => {
	const normalizedQuery = query.trim().toLowerCase();
	if (normalizedQuery === "") {
		return openPullRequests;
	}
	return openPullRequests.filter((pr) => {
		return (
			pr.title.toLowerCase().includes(normalizedQuery) ||
			pr.author.toLowerCase().includes(normalizedQuery) ||
			`#${pr.number}`.includes(normalizedQuery)
		);
	});
});

function ensureOpenPullRequestsLoaded(): void {
	if (loadedProjectPath === projectPath || (loading && loadingProjectPath === projectPath)) {
		return;
	}
	const requestedProjectPath = projectPath;
	loading = true;
	loadingProjectPath = requestedProjectPath;
	loadError = null;
	void getRepoContext(requestedProjectPath)
		.andThen((repoContext) =>
			listPullRequests(repoContext.owner, repoContext.repo, "open").map((prs) => ({
				prs,
				repoContext,
			}))
		)
		.match(
			({ prs, repoContext }) => {
				if (loadingProjectPath !== requestedProjectPath) return;
				openPullRequests = prs;
				loadedProjectPath = requestedProjectPath;
				loadedRepoContext = repoContext;
				loading = false;
				loadingProjectPath = null;
			},
			(error) => {
				if (loadingProjectPath !== requestedProjectPath) return;
				loadError = error.message;
				loading = false;
				loadingProjectPath = null;
			}
		);
}

function handleTogglePicker(): void {
	if (pickerOpen) {
		pickerOpen = false;
		query = "";
		return;
	}
	pickerOpen = true;
	ensureOpenPullRequestsLoaded();
}

function handleSubmenuOpenChange(open: boolean): void {
	if (open) {
		ensureOpenPullRequestsLoaded();
	} else {
		query = "";
	}
}

function handleClosePicker(): void {
	pickerOpen = false;
	query = "";
}

function handleUseAutomaticLinking(): void {
	void sessionStore.restoreAutomaticSessionPrLink(sessionId, projectPath).match(
		() => {
			handleClosePicker();
		},
		(error) => {
			toast.error(`Failed to restore automatic linking: ${error.message}`);
		}
	);
}

function handleSelectPullRequest(pr: PrListItem): void {
	void sessionStore.updateSessionPrLink(sessionId, projectPath, pr.number, "manual").match(
		() => {
			handleClosePicker();
		},
		(error) => {
			toast.error(`Failed to link pull request: ${error.message}`);
		}
	);
}

/**
 * Transfer a PR link from `otherSessionId` to the current session:
 * 1. Unlink `otherSessionId` (set its prNumber to null, manual mode).
 * 2. Link current session to the same PR (manual mode).
 */
async function handleTransferPrLink(
	otherSessionId: string,
	prNumber: number
): Promise<void> {
	// Unlink the other session first.
	const unlinkResult = await sessionStore.updateSessionPrLink(
		otherSessionId,
		projectPath,
		null,
		"manual"
	);
	if (unlinkResult.isErr()) {
		toast.error(`Failed to unlink other session: ${unlinkResult.error.message}`);
		return;
	}

	// Link this session.
	const linkResult = await sessionStore.updateSessionPrLink(
		sessionId,
		projectPath,
		prNumber,
		"manual"
	);
	if (linkResult.isErr()) {
		toast.error(`Failed to link pull request: ${linkResult.error.message}`);
		return;
	}

	handleClosePicker();
}
</script>

<div bind:this={anchorRef} class={variant === "footer" ? "flex items-center" : "contents"}>
	{#if variant === "menu"}
		<DropdownMenu.Sub onOpenChange={handleSubmenuOpenChange}>
			<DropdownMenu.SubTrigger class="cursor-pointer">
				<span class="flex-1">Link existing</span>
				{#if linkedPr}
					<span class="text-[10px] text-muted-foreground tabular-nums">#{linkedPr.prNumber}</span>
				{/if}
			</DropdownMenu.SubTrigger>
			<DropdownMenu.SubContent class="w-[300px] p-0 overflow-hidden">
				{#if openPullRequests.length >= 10}
					<div class="px-2 py-1.5">
						<Input bind:value={query} placeholder="Search open PRs" class="h-7 text-xs" />
					</div>
				{/if}

				<div class="max-h-80 overflow-y-auto px-1 py-1">
					{#if prLinkMode === "manual"}
						<button
							type="button"
							class="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[11px] hover:bg-accent"
							onclick={handleUseAutomaticLinking}
						>
							<span>Use automatic linking</span>
							<span class="text-[10px] text-muted-foreground">Clear lock</span>
						</button>
					{/if}

					{#if loading}
						<div class="px-2 py-3 text-[11px] text-muted-foreground">Loading pull requests…</div>
					{:else if loadError}
						<div class="px-2 py-3 text-[11px] text-destructive">{loadError}</div>
					{:else if filteredPullRequests.length === 0}
						<div class="px-2 py-3 text-[11px] text-muted-foreground">
							No open pull requests in this repository
						</div>
					{:else}
						{#each filteredPullRequests as pr (pr.number)}
							{@const linkedSessions = sessionsByPrNumber.get(pr.number) ?? []}
							{@const isCurrent = linkedPr?.prNumber === pr.number}
							<div
								class="group flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-accent {isCurrent
									? 'bg-accent/60'
									: ''}"
							>
								<button
									type="button"
									class="flex flex-1 min-w-0 items-center gap-2 text-left"
									onclick={() => handleSelectPullRequest(pr)}
								>
									{#if loadedRepoContext}
										<GitHubBadge
											ref={{
												type: "pr",
												owner: loadedRepoContext.owner,
												repo: loadedRepoContext.repo,
												number: pr.number,
											}}
											prState={pr.state}
										/>
									{/if}
									<div class="min-w-0 flex-1">
										<div class="truncate text-[11px] leading-tight text-foreground">{pr.title}</div>
										<div class="truncate text-[10px] leading-tight text-muted-foreground">
											{pr.author}
										</div>
									</div>
								</button>
								{#if linkedSessions.length > 0 && project}
									<div class="flex items-center gap-0.5 shrink-0">
										{#each linkedSessions as linkedSession (linkedSession.id)}
											{@const isSelf = linkedSession.id === sessionId}
											<button
												type="button"
												class="shrink-0 rounded transition-opacity {isSelf
													? 'opacity-100'
													: 'opacity-70 hover:opacity-100'}"
												title={isSelf
													? "This session"
													: `Transfer link from this session (#${pr.number})`}
												aria-label={isSelf
													? "Currently linked session"
													: `Transfer PR link from session`}
												disabled={isSelf}
												onclick={(e) => {
													e.stopPropagation();
													if (isSelf) return;
													void handleTransferPrLink(linkedSession.id, pr.number);
												}}
											>
												<ProjectLetterBadge
													name={project.name}
													color={project.color}
													iconSrc={project.iconPath ?? null}
													size={16}
													sequenceId={linkedSession.sequenceId ?? null}
												/>
											</button>
										{/each}
									</div>
								{/if}
							</div>
						{/each}
					{/if}
				</div>
			</DropdownMenu.SubContent>
		</DropdownMenu.Sub>
	{:else if variant === "header-icon"}
		<Tooltip.Provider delayDuration={400}>
			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<button
							{...props}
							bind:this={headerIconRef}
							type="button"
							onclick={handleTogglePicker}
							class="self-stretch flex items-center px-1.5 border-l border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset {pickerOpen
								? 'bg-muted/80 text-foreground'
								: ''}"
							aria-label={linkedPr ? `Linked to #${linkedPr.prNumber}` : "Link existing PR"}
						>
							{#if linkedPr}
								<span class="inline-flex items-center gap-1 text-[0.6875rem] font-medium tabular-nums shrink-0">
									<PrStateIcon state={linkedPr.state} size={11} />
									#{linkedPr.prNumber}
								</span>
							{:else}
								<LinkSimple size={11} weight="bold" class="shrink-0" />
							{/if}
						</button>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Portal>
					<Tooltip.Content
						class="z-[var(--overlay-z)] rounded-md bg-popover px-2 py-1 text-[11px] text-popover-foreground shadow-md max-w-[320px] truncate"
						sideOffset={4}
						side="top"
					>
						{linkedPr ? `Linked to #${linkedPr.prNumber}` : "Link existing PR"}
					</Tooltip.Content>
				</Tooltip.Portal>
			</Tooltip.Root>
		</Tooltip.Provider>
	{:else}
		<Tooltip.Provider delayDuration={400}>
			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<button
							{...props}
							type="button"
							onclick={handleTogglePicker}
							class="h-7 inline-flex items-center gap-1.5 px-3 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset {pickerOpen
								? 'bg-accent text-foreground'
								: ''}"
							aria-label={tooltipLabel}
						>
							{#if linkedPr}
								<PrStateIcon state={linkedPr.state} size={12} />
								<span class="text-[0.6875rem] font-medium tabular-nums text-foreground shrink-0">
									#{linkedPr.prNumber}
								</span>
							{:else}
								<span class="text-[0.6875rem] font-medium">Link PR</span>
							{/if}
						</button>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Portal>
					<Tooltip.Content
						class="z-[var(--overlay-z)] rounded-md bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md max-w-[320px] truncate"
						sideOffset={4}
						side="top"
					>
						{tooltipLabel}
					</Tooltip.Content>
				</Tooltip.Portal>
			</Tooltip.Root>
		</Tooltip.Provider>
	{/if}
</div>

{#if variant === "footer" || variant === "header-icon"}
	<Popover.Root bind:open={pickerOpen}>
		<Popover.Content
			customAnchor={(variant === "header-icon" ? headerIconRef : anchorRef) ?? undefined}
			align={variant === "header-icon" ? "end" : "start"}
			side={variant === "header-icon" ? "bottom" : "top"}
			sideOffset={6}
			class="w-[300px] p-0 overflow-hidden"
			onInteractOutside={handleClosePicker}
		>
			{#if openPullRequests.length >= 10}
				<div class="px-2 py-1.5">
					<Input bind:value={query} placeholder="Search open PRs" class="h-7 text-xs" />
				</div>
			{/if}

			<div class="max-h-80 overflow-y-auto px-1 py-1">
				{#if prLinkMode === "manual"}
					<button
						type="button"
						class="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[11px] hover:bg-accent"
						onclick={handleUseAutomaticLinking}
					>
						<span>Use automatic linking</span>
						<span class="text-[10px] text-muted-foreground">Clear lock</span>
					</button>
				{/if}

				{#if loading}
					<div class="px-2 py-3 text-[11px] text-muted-foreground">Loading pull requests…</div>
				{:else if loadError}
					<div class="px-2 py-3 text-[11px] text-destructive">{loadError}</div>
				{:else if filteredPullRequests.length === 0}
					<div class="px-2 py-3 text-[11px] text-muted-foreground">
						No open pull requests in this repository
					</div>
				{:else}
					{#each filteredPullRequests as pr (pr.number)}
						{@const linkedSessions = sessionsByPrNumber.get(pr.number) ?? []}
						{@const isCurrent = linkedPr?.prNumber === pr.number}
						<div
							class="group flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-accent {isCurrent
								? 'bg-accent/60'
								: ''}"
						>
							<button
								type="button"
								class="flex flex-1 min-w-0 items-center gap-2 text-left"
								onclick={() => handleSelectPullRequest(pr)}
							>
								{#if loadedRepoContext}
									<GitHubBadge
										ref={{
											type: "pr",
											owner: loadedRepoContext.owner,
											repo: loadedRepoContext.repo,
											number: pr.number,
										}}
										prState={pr.state}
									/>
								{/if}
								<div class="min-w-0 flex-1">
									<div class="truncate text-[11px] leading-tight text-foreground">{pr.title}</div>
									<div class="truncate text-[10px] leading-tight text-muted-foreground">
										{pr.author}
									</div>
								</div>
							</button>
							{#if linkedSessions.length > 0 && project}
								<div class="flex items-center gap-0.5 shrink-0">
									{#each linkedSessions as linkedSession (linkedSession.id)}
										{@const isSelf = linkedSession.id === sessionId}
										<button
											type="button"
											class="shrink-0 rounded transition-opacity {isSelf
												? 'opacity-100'
												: 'opacity-70 hover:opacity-100'}"
											title={isSelf
												? "This session"
												: `Transfer link from this session (#${pr.number})`}
											aria-label={isSelf
												? "Currently linked session"
												: `Transfer PR link from session`}
											disabled={isSelf}
											onclick={(e) => {
												e.stopPropagation();
												if (isSelf) return;
												void handleTransferPrLink(linkedSession.id, pr.number);
											}}
										>
											<ProjectLetterBadge
												name={project.name}
												color={project.color}
												iconSrc={project.iconPath ?? null}
												size={16}
												sequenceId={linkedSession.sequenceId ?? null}
											/>
										</button>
									{/each}
								</div>
							{/if}
						</div>
					{/each}
				{/if}
			</div>
		</Popover.Content>
	</Popover.Root>
{/if}
