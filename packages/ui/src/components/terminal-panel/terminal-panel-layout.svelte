<script lang="ts">
	import type { Snippet } from "svelte";

	import { IconTerminal } from "@tabler/icons-svelte";
	import { ProjectLetterBadge } from "../project-letter-badge/index.js";
	import {
		CloseAction,
		EmbeddedPanelHeader,
		HeaderActionCell,
		HeaderCell,
		HeaderTitleCell,
	} from "../panel-header/index.js";

	interface Props {
		projectName: string;
		projectColor: string;
		projectIconSrc?: string | null;
		shell: string | null;
		hideProjectBadge?: boolean;
		loading: boolean;
		error: string | null;
		onClose: () => void;
		terminalContent: Snippet;
		header?: Snippet;
	}

	let {
		projectName,
		projectColor,
		projectIconSrc = null,
		shell,
		hideProjectBadge = false,
		loading,
		error,
		onClose,
		terminalContent,
		header,
	}: Props = $props();

	const shellName = $derived(shell?.split("/").pop() ?? null);
</script>

{#if header}
	{@render header()}
{:else}
	<EmbeddedPanelHeader>
		{#if !hideProjectBadge}
			<HeaderCell>
				{#snippet children()}
					<div class="inline-flex items-center justify-center h-7 w-7 shrink-0">
						<ProjectLetterBadge
							name={projectName}
							color={projectColor}
							iconSrc={projectIconSrc}
							size={28}
							fontSize={15}
							class="!rounded-none !rounded-tl-lg"
						/>
					</div>
				{/snippet}
			</HeaderCell>
		{/if}

		<HeaderTitleCell>
			{#snippet children()}
				<div class="flex items-center gap-1.5 min-w-0">
					<IconTerminal class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
					<span class="text-[11px] font-medium truncate">Terminal</span>
					{#if shellName}
						<span class="text-[11px] text-muted-foreground truncate">({shellName})</span>
					{/if}
				</div>
			{/snippet}
		</HeaderTitleCell>

		<HeaderActionCell withDivider={true}>
			{#snippet children()}
				<CloseAction onClose={onClose} />
			{/snippet}
		</HeaderActionCell>
	</EmbeddedPanelHeader>
{/if}

<div class="flex-1 min-h-0 overflow-hidden bg-card/50">
	{#if error}
		<div class="p-4 text-sm text-destructive">{error}</div>
	{:else if shell}
		{@render terminalContent()}
	{:else if loading}
		<div class="flex flex-col gap-2 p-4">
			<div class="flex items-center gap-2 text-muted-foreground text-sm">
				<div class="h-4 w-4 rounded bg-muted animate-pulse"></div>
				<span>Loading shell...</span>
			</div>
		</div>
	{/if}
</div>
