<script lang="ts">
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import type { PrListItem } from "$lib/acp/types/github-integration.js";
import type {
	SessionLinkedPr,
	SessionPrLinkMode,
} from "$lib/acp/application/dto/session-linked-pr.js";
import PrStateIcon from "$lib/acp/components/pr-state-icon.svelte";
import { listPullRequests, getRepoContext } from "$lib/acp/services/github-service.js";
import { getSessionStore } from "$lib/acp/store/session-store.svelte.js";
import { Input } from "$lib/components/ui/input/index.js";
import * as Popover from "$lib/components/ui/popover/index.js";
import { toast } from "svelte-sonner";

interface Props {
	sessionId: string;
	projectPath: string;
	linkedPr?: SessionLinkedPr | null;
	prLinkMode?: SessionPrLinkMode | null;
}

let { sessionId, projectPath, linkedPr = null, prLinkMode = "automatic" }: Props = $props();

const sessionStore = getSessionStore();

let triggerAnchor = $state<HTMLDivElement | null>(null);
let pickerOpen = $state(false);
let query = $state("");
let loadError = $state<string | null>(null);
let loading = $state(false);
let loadingProjectPath = $state<string | null>(null);
let openPullRequests = $state<readonly PrListItem[]>([]);
let loadedProjectPath = $state<string | null>(null);

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

function normalizePrState(state: PrListItem["state"]): SessionLinkedPr["state"] {
	switch (state) {
		case "merged":
			return "MERGED";
		case "closed":
			return "CLOSED";
		case "open":
			return "OPEN";
	}
}

function ensureOpenPullRequestsLoaded(): void {
	if (loadedProjectPath === projectPath || (loading && loadingProjectPath === projectPath)) {
		return;
	}

	const requestedProjectPath = projectPath;
	loading = true;
	loadingProjectPath = requestedProjectPath;
	loadError = null;
	void getRepoContext(requestedProjectPath)
		.andThen((repoContext) => listPullRequests(repoContext.owner, repoContext.repo, "open"))
		.match(
			(prs) => {
				if (loadingProjectPath !== requestedProjectPath) {
					return;
				}

				openPullRequests = prs;
				loadedProjectPath = requestedProjectPath;
				loading = false;
				loadingProjectPath = null;
			},
			(error) => {
				if (loadingProjectPath !== requestedProjectPath) {
					return;
				}

				loadError = error.message;
				loading = false;
				loadingProjectPath = null;
			}
		);
}

function handleOpenPicker(event: Event): void {
	event.preventDefault();
	pickerOpen = true;
	ensureOpenPullRequestsLoaded();
}

function handleClosePicker(): void {
	pickerOpen = false;
	query = "";
	triggerAnchor?.focus();
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
</script>

<div bind:this={triggerAnchor}>
	<DropdownMenu.Item onSelect={handleOpenPicker} class="cursor-pointer">
		{linkedPr ? "Change linked pull request" : "Link pull request"}
	</DropdownMenu.Item>
</div>

<Popover.Root bind:open={pickerOpen}>
	<Popover.Content
		customAnchor={triggerAnchor ?? undefined}
		align="end"
		sideOffset={6}
		class="w-[320px] p-0 overflow-hidden"
		onInteractOutside={handleClosePicker}
	>
		<div class="border-b border-border/40 px-3 py-2">
			<p class="text-[11px] font-medium">Pull request link</p>
			<p class="mt-0.5 text-[10px] text-muted-foreground">
				{#if linkedPr}
					{prLinkMode === "manual" ? "Manual" : "Automatic"} link to #{linkedPr.prNumber}
				{:else}
					No linked pull request
				{/if}
			</p>
		</div>

		<div class="border-b border-border/40 px-3 py-2">
			<Input bind:value={query} placeholder="Search open pull requests" class="h-8 text-xs" />
		</div>

		<div class="max-h-72 overflow-y-auto p-1">
			{#if prLinkMode === "manual"}
				<button
					type="button"
					class="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-xs hover:bg-accent"
					onclick={handleUseAutomaticLinking}
				>
					<span>Use automatic linking</span>
					<span class="text-[10px] text-muted-foreground">Clear manual lock</span>
				</button>
			{/if}

			{#if loading}
				<div class="px-2 py-4 text-xs text-muted-foreground">Loading pull requests…</div>
			{:else if loadError}
				<div class="px-2 py-4 text-xs text-destructive">{loadError}</div>
			{:else if filteredPullRequests.length === 0}
				<div class="px-2 py-4 text-xs text-muted-foreground">
					No open pull requests in this repository
				</div>
			{:else}
				{#each filteredPullRequests as pr (pr.number)}
					<button
						type="button"
						class="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-accent"
						onclick={() => handleSelectPullRequest(pr)}
					>
						<div class="mt-0.5 shrink-0">
							<PrStateIcon state={normalizePrState(pr.state)} size={12} />
						</div>
						<div class="min-w-0 flex-1">
							<div class="truncate text-xs font-medium text-foreground">{pr.title}</div>
							<div class="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
								<span>#{pr.number}</span>
								<span>·</span>
								<span class="truncate">{pr.author}</span>
							</div>
						</div>
						{#if linkedPr?.prNumber === pr.number}
							<div class="text-[10px] text-muted-foreground">Current</div>
						{/if}
					</button>
				{/each}
			{/if}
		</div>

		{#if linkedPr?.url}
			<div class="border-t border-border/40 px-3 py-2 text-[10px] text-muted-foreground">
				Linked PR opens in Source Control from the badge/footer. Use the GitHub action there for the external link.
			</div>
		{/if}
	</Popover.Content>
</Popover.Root>
