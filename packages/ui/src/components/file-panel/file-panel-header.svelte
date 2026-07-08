<script lang="ts">
	import type { Snippet } from "svelte";

	import { ProjectLetterBadge } from "../project-letter-badge/index.js";
	import { DiffPill } from "../diff-pill/index.js";
	import { RoundedIcon } from "../icons/index.js";
	import {
		CloseAction,
		EmbeddedPanelHeader,
		HeaderActionCell,
		HeaderCell,
		HeaderTitleCell,
	} from "../panel-header/index.js";

	interface DisplayMode {
		readonly id: string;
		readonly label: string;
	}

	interface Props {
		fileName: string;
		filePath: string;
		projectName: string;
		projectColor: string;
		projectBadgeLabel?: string | null;
		projectIconSrc?: string | null;
		compact?: boolean;
		hideProjectBadge?: boolean;
		insertions?: number;
		deletions?: number;
		hasContent: boolean;
		displayModes: readonly DisplayMode[];
		activeDisplayMode: string;
		onDisplayModeChange?: (mode: string) => void;
		editorModes?: readonly DisplayMode[];
		activeEditorMode?: string;
		onEditorModeChange?: (mode: string) => void;
		onClose: () => void;
		fileIcon?: Snippet;
		fileLabel?: Snippet;
		actions?: Snippet;
	}

	let {
		fileName,
		filePath,
		projectName,
		projectColor,
		projectBadgeLabel = null,
		projectIconSrc = null,
		compact = false,
		hideProjectBadge = false,
		insertions,
		deletions,
		hasContent,
		displayModes = [],
		activeDisplayMode = "raw",
		onDisplayModeChange,
		editorModes = [],
		activeEditorMode,
		onEditorModeChange,
		onClose,
		fileIcon,
		fileLabel,
		actions,
	}: Props = $props();

	const showDisplayToggle = $derived(
		hasContent && displayModes.length > 1 && typeof onDisplayModeChange === "function"
	);
	const showEditorModeToggle = $derived(
		hasContent && editorModes.length > 1 && typeof onEditorModeChange === "function"
	);
</script>

{#snippet structuredDisplayIcon()}
	<span
		class="inline-flex h-4 w-4 flex-col justify-center gap-[2px]"
		data-testid="file-panel-structured-display-icon"
		aria-hidden="true"
	>
		<span class="flex items-center gap-[2px]">
			<span class="size-1 rounded-full bg-current"></span>
			<span class="h-px w-2.5 rounded-full bg-current"></span>
		</span>
		<span class="ml-1.5 flex items-center gap-[2px]">
			<span class="size-1 rounded-full bg-current"></span>
			<span class="h-px w-2 rounded-full bg-current"></span>
		</span>
		<span class="ml-1.5 flex items-center gap-[2px]">
			<span class="size-1 rounded-full bg-current"></span>
			<span class="h-px w-2 rounded-full bg-current"></span>
		</span>
	</span>
{/snippet}

{#snippet tableDisplayIcon()}
	<span
		class="grid h-4 w-4 grid-cols-3 grid-rows-3 gap-px"
		data-testid="file-panel-table-display-icon"
		aria-hidden="true"
	>
		{#each Array.from({ length: 9 }) as _, index (index)}
			<span class="rounded-[1px] border border-current"></span>
		{/each}
	</span>
{/snippet}

<EmbeddedPanelHeader>
	{#if !compact}
		{#if !hideProjectBadge}
			<HeaderCell>
				{#snippet children()}
					<div class="inline-flex items-center justify-center h-7 w-7 shrink-0">
						<ProjectLetterBadge
							name={projectName}
							label={projectBadgeLabel}
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
					{#if fileIcon}
						{@render fileIcon()}
					{/if}
					{#if fileLabel}
						{@render fileLabel()}
					{:else}
						<span class="text-[11px] truncate min-w-0" title={filePath}>{fileName}</span>
					{/if}
					{#if insertions !== undefined || deletions !== undefined}
						<DiffPill insertions={insertions ?? 0} deletions={deletions ?? 0} />
					{/if}
				</div>
			{/snippet}
		</HeaderTitleCell>
	{/if}

	{#if showDisplayToggle}
		<HeaderActionCell withDivider={true}>
			{#snippet children()}
				{#each displayModes as item (item.id)}
					<button
						type="button"
						onclick={() => onDisplayModeChange?.(item.id)}
						class="h-7 inline-flex items-center gap-1.5 px-3 text-xs font-medium border-l border-border/50 first:border-l-0 transition-colors {activeDisplayMode ===
						item.id
							? 'bg-background text-foreground'
							: 'text-muted-foreground hover:text-foreground hover:bg-accent/40'}"
						data-header-control
					>
						{#if item.id === "rendered"}
							<RoundedIcon name="eye" class="h-4 w-4" />
						{:else if item.id === "structured"}
							{@render structuredDisplayIcon()}
						{:else if item.id === "table"}
							{@render tableDisplayIcon()}
						{:else}
							<RoundedIcon name="code" class="h-4 w-4" />
						{/if}
						<span>{item.label}</span>
					</button>
				{/each}
			{/snippet}
		</HeaderActionCell>
	{/if}

	{#if showEditorModeToggle}
		<HeaderActionCell withDivider={true}>
			{#snippet children()}
				{#each editorModes as item (item.id)}
					<button
						type="button"
						onclick={() => onEditorModeChange?.(item.id)}
						class="h-7 inline-flex items-center gap-1.5 px-3 text-xs font-medium border-l border-border/50 first:border-l-0 transition-colors {(activeEditorMode ??
						'') === item.id
							? 'bg-background text-foreground'
							: 'text-muted-foreground hover:text-foreground hover:bg-accent/40'}"
						data-header-control
					>
						{#if item.id === "write"}
							<RoundedIcon name="pencil" class="h-4 w-4" />
						{:else}
							<RoundedIcon name="notebook" class="h-4 w-4" />
						{/if}
						<span>{item.label}</span>
					</button>
				{/each}
			{/snippet}
		</HeaderActionCell>
	{/if}

	<HeaderActionCell withDivider={true}>
		{#snippet children()}
			{#if actions}
				{@render actions()}
			{:else if !compact}
				<CloseAction onClose={onClose} />
			{/if}
		{/snippet}
	</HeaderActionCell>
</EmbeddedPanelHeader>
