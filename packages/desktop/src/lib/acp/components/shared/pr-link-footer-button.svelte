<script lang="ts">
import * as Popover from "@acepe/ui/popover";
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import {
	Button,
	RoundedIcon,
	SessionPrLinkPickerPanel,
	type SessionPrLinkPickerProject,
	type SessionPrLinkPickerPullRequest,
} from "@acepe/ui";
import type { PrListItem, RepoContext } from "$lib/acp/types/github-integration.js";
import type {
	SessionLinkedPr,
	SessionPrLinkMode,
	SessionPrLinkReference,
} from "$lib/acp/application/dto/session-linked-pr.js";
import type { Project } from "$lib/acp/logic/project-manager.svelte.js";
import PrStateIcon from "$lib/acp/components/pr-state-icon.svelte";
import { listPullRequests, getRepoContext } from "$lib/acp/services/github-service.js";
import { getSessionStore } from "$lib/acp/store/session-store.svelte.js";
import { toast } from "svelte-sonner";
import { Tooltip } from "bits-ui";
import {
	filterPullRequestsByQuery,
	getHeaderPrLinkLabel,
	getLinkedPrTooltipLabel,
	getPrPickerListState,
	groupSessionPrLinksByNumber,
	shouldLoadOpenPullRequests,
	shouldShowPrSearchInput,
} from "./pr-link-picker-state.js";

interface Props {
	sessionId: string;
	projectPath: string;
	linkedPr?: SessionLinkedPr | null;
	prLinkMode?: SessionPrLinkMode | null;
	projectPrLinkReferences?: readonly SessionPrLinkReference[];
	project?: Project | null;
	projectBadgeLabel?: string | null;
	variant?: "footer" | "menu" | "header-icon";
	triggerClass?: string;
	inButtonGroup?: boolean;
}

let {
	sessionId,
	projectPath,
	linkedPr = null,
	prLinkMode = "automatic",
	projectPrLinkReferences = [],
	project = null,
	projectBadgeLabel = null,
	variant = "footer",
	triggerClass = "",
	inButtonGroup = false,
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

const tooltipLabel = $derived(getLinkedPrTooltipLabel(linkedPr));
const headerPrLinkLabel = $derived(getHeaderPrLinkLabel(linkedPr));
const sessionsByPrNumber = $derived(groupSessionPrLinksByNumber(projectPrLinkReferences));
const pickerPullRequests = $derived(mapPullRequestsForPicker(openPullRequests));
const filteredPullRequests = $derived(filterPullRequestsByQuery(pickerPullRequests, query));
const showSearchInput = $derived(shouldShowPrSearchInput(openPullRequests.length));
const listState = $derived(
	getPrPickerListState({
		loading,
		loadError,
		filteredPullRequests,
	})
);
const pickerProject = $derived(mapProjectForPicker(project));
const pickerRepoContext = $derived(
	loadedRepoContext
		? {
				owner: loadedRepoContext.owner,
				repo: loadedRepoContext.repo,
			}
		: null
);

function mapPullRequestsForPicker(
	pullRequests: readonly PrListItem[]
): readonly SessionPrLinkPickerPullRequest[] {
	return pullRequests.map((pullRequest) => ({
		number: pullRequest.number,
		title: pullRequest.title,
		author: pullRequest.author,
		state: pullRequest.state,
	}));
}

function mapProjectForPicker(value: Project | null): SessionPrLinkPickerProject | null {
	if (!value) {
		return null;
	}
	return {
		name: value.name,
		badgeLabel: projectBadgeLabel,
		color: value.color,
		iconPath: value.iconPath ?? null,
	};
}

function ensureOpenPullRequestsLoaded(): void {
	if (
		!shouldLoadOpenPullRequests({
			projectPath,
			loadedProjectPath,
			loading,
			loadingProjectPath,
		})
	) {
		return;
	}
	const requestedProjectPath = projectPath;
	loading = true;
	loadingProjectPath = requestedProjectPath;
	loadError = null;
	void getRepoContext(requestedProjectPath)
		.andThen((repoContext) =>
			listPullRequests(repoContext.owner, repoContext.repo, "open").map((pullRequests) => ({
				pullRequests,
				repoContext,
			}))
		)
		.match(
			({ pullRequests, repoContext }) => {
				if (loadingProjectPath !== requestedProjectPath) return;
				openPullRequests = pullRequests;
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
	void sessionStore.connection.restoreAutomaticSessionPrLink(sessionId, projectPath).match(
		() => {
			handleClosePicker();
		},
		(error) => {
			toast.error(`Failed to restore automatic linking: ${error.message}`);
		}
	);
}

function handleSelectPullRequest(pr: SessionPrLinkPickerPullRequest): void {
	void sessionStore.connection.updateSessionPrLink(sessionId, projectPath, pr.number, "manual").match(
		() => {
			handleClosePicker();
		},
		(error) => {
			toast.error(`Failed to link pull request: ${error.message}`);
		}
	);
}

async function handleTransferPrLink(otherSessionId: string, prNumber: number): Promise<void> {
	const unlinkResult = await sessionStore.connection.updateSessionPrLink(
		otherSessionId,
		projectPath,
		null,
		"manual"
	);
	if (unlinkResult.isErr()) {
		toast.error(`Failed to unlink other session: ${unlinkResult.error.message}`);
		return;
	}

	const linkResult = await sessionStore.connection.updateSessionPrLink(
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

{#snippet pickerPanel()}
	<SessionPrLinkPickerPanel
		{listState}
		{query}
		{showSearchInput}
		{linkedPr}
		{sessionId}
		project={pickerProject}
		repoContext={pickerRepoContext}
		{sessionsByPrNumber}
		showAutomaticLinkingOption={prLinkMode === "manual"}
		onQueryChange={(nextQuery) => {
			query = nextQuery;
		}}
		onSelectPullRequest={handleSelectPullRequest}
		onUseAutomaticLinking={handleUseAutomaticLinking}
		onTransferPrLink={(otherSessionId, prNumber) => {
			void handleTransferPrLink(otherSessionId, prNumber);
		}}
	/>
{/snippet}

{#snippet headerIconGroupButton()}
	<Button
		bind:ref={headerIconRef}
		variant="outline"
		size="xs"
		type="button"
		class={triggerClass}
		title={headerPrLinkLabel}
		onclick={handleTogglePicker}
		aria-label={headerPrLinkLabel}
	>
		{#if linkedPr}
			<PrStateIcon state={linkedPr.state} size={11} />
			#{linkedPr.prNumber}
		{:else}
			<RoundedIcon name="link" class="size-[11px] shrink-0" />
		{/if}
	</Button>
{/snippet}

{#if variant === "header-icon" && inButtonGroup}
	{@render headerIconGroupButton()}
{:else if variant === "menu"}
	<DropdownMenu.Sub onOpenChange={handleSubmenuOpenChange}>
		<DropdownMenu.SubTrigger class="cursor-pointer">
			<span class="flex-1">Link existing</span>
			{#if linkedPr}
				<span class="text-[10px] text-muted-foreground tabular-nums">#{linkedPr.prNumber}</span>
			{/if}
		</DropdownMenu.SubTrigger>
		<DropdownMenu.SubContent class="w-[300px] overflow-hidden p-0">
			{@render pickerPanel()}
		</DropdownMenu.SubContent>
	</DropdownMenu.Sub>
{:else}
	<div bind:this={anchorRef} class={variant === "footer" ? "flex items-center" : "contents"}>
		{#if variant === "header-icon"}
			<Tooltip.Provider delayDuration={400}>
				<Tooltip.Root>
					<Tooltip.Trigger>
						{#snippet child({ props })}
							<Button
								{...props}
								bind:ref={headerIconRef}
								variant="secondary"
								size="xs"
								type="button"
								class={triggerClass}
								onclick={handleTogglePicker}
								aria-label={headerPrLinkLabel}
							>
								{#if linkedPr}
									<PrStateIcon state={linkedPr.state} size={11} />
									#{linkedPr.prNumber}
								{:else}
									<RoundedIcon name="link" class="size-[11px] shrink-0" />
								{/if}
							</Button>
						{/snippet}
					</Tooltip.Trigger>
					<Tooltip.Portal>
						<Tooltip.Content
							class="z-[var(--overlay-z)] rounded-md bg-popover px-2 py-1 text-[11px] text-popover-foreground shadow-md max-w-[320px] truncate"
							sideOffset={4}
							side="top"
						>
							{headerPrLinkLabel}
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
{/if}

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
			{@render pickerPanel()}
		</Popover.Content>
	</Popover.Root>
{/if}
