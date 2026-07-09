<script lang="ts">
	import { GitHubBadge } from "../github-badge/index.js";
	import { ProjectLetterBadge } from "../project-letter-badge/index.js";
	import { Input } from "../input/index.js";
	import type { PrPickerListState } from "./session-pr-link-picker-state.js";
	import type {
		SessionPrLinkPickerLinkedPr,
		SessionPrLinkPickerProject,
		SessionPrLinkPickerPullRequest,
		SessionPrLinkPickerReference,
		SessionPrLinkPickerRepoContext,
	} from "./types.js";

	interface Props {
		listState: PrPickerListState;
		query: string;
		showSearchInput: boolean;
		linkedPr?: SessionPrLinkPickerLinkedPr | null;
		sessionId: string;
		project?: SessionPrLinkPickerProject | null;
		repoContext?: SessionPrLinkPickerRepoContext | null;
		sessionsByPrNumber: ReadonlyMap<number, readonly SessionPrLinkPickerReference[]>;
		showAutomaticLinkingOption?: boolean;
		searchPlaceholder?: string;
		automaticLinkingLabel?: string;
		automaticLinkingHint?: string;
		onQueryChange: (query: string) => void;
		onSelectPullRequest: (pullRequest: SessionPrLinkPickerPullRequest) => void;
		onUseAutomaticLinking?: () => void;
		onTransferPrLink?: (otherSessionId: string, prNumber: number) => void;
	}

	let {
		listState,
		query,
		showSearchInput,
		linkedPr = null,
		sessionId,
		project = null,
		repoContext = null,
		sessionsByPrNumber,
		showAutomaticLinkingOption = false,
		searchPlaceholder = "Search open PRs",
		automaticLinkingLabel = "Use automatic linking",
		automaticLinkingHint = "Clear lock",
		onQueryChange,
		onSelectPullRequest,
		onUseAutomaticLinking,
		onTransferPrLink,
	}: Props = $props();
</script>

{#if showSearchInput}
	<div class="px-2 py-1.5">
		<Input
			value={query}
			oninput={(event) => onQueryChange(event.currentTarget.value)}
			placeholder={searchPlaceholder}
			class="h-7 text-xs"
		/>
	</div>
{/if}

<div class="max-h-80 overflow-y-auto px-1 py-1">
	{#if showAutomaticLinkingOption && onUseAutomaticLinking}
		<button
			type="button"
			class="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[11px] hover:bg-accent"
			onclick={onUseAutomaticLinking}
		>
			<span>{automaticLinkingLabel}</span>
			<span class="text-[10px] text-muted-foreground">{automaticLinkingHint}</span>
		</button>
	{/if}

	{#if listState.kind === "loading"}
		<div class="px-2 py-3 text-[11px] text-muted-foreground">{listState.message}</div>
	{:else if listState.kind === "error"}
		<div class="px-2 py-3 text-[11px] text-destructive">{listState.message}</div>
	{:else if listState.kind === "empty"}
		<div class="px-2 py-3 text-[11px] text-muted-foreground">{listState.message}</div>
	{:else}
		{#each listState.pullRequests as pr (pr.number)}
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
					onclick={() => onSelectPullRequest(pr)}
				>
					{#if repoContext}
						<GitHubBadge
							ref={{
								type: "pr",
								owner: repoContext.owner,
								repo: repoContext.repo,
								number: pr.number,
							}}
							prState={pr.state}
						/>
					{/if}
					<div class="min-w-0 flex-1">
						<div class="truncate text-[11px] leading-tight text-foreground">{pr.title}</div>
						<div class="truncate text-[10px] leading-tight text-muted-foreground">{pr.author}</div>
					</div>
				</button>
				{#if linkedSessions.length > 0 && project && onTransferPrLink}
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
									: "Transfer PR link from session"}
								disabled={isSelf}
								onclick={(event) => {
									event.stopPropagation();
									if (isSelf) return;
									onTransferPrLink(linkedSession.id, pr.number);
								}}
							>
								<ProjectLetterBadge
									name={project.name}
									label={project.badgeLabel ?? null}
									color={project.color}
									iconSrc={project.iconPath}
									size={16}
									sequenceId={linkedSession.sequenceId}
								/>
							</button>
						{/each}
					</div>
				{/if}
			</div>
		{/each}
	{/if}
</div>
