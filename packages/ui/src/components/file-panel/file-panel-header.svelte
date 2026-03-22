<script lang="ts">
	import type { Snippet } from "svelte";

	import IconListTree from "@tabler/icons-svelte/icons/list-tree";
	import IconTable from "@tabler/icons-svelte/icons/table";
	import IconCode from "@tabler/icons-svelte/icons/code";
	import IconEye from "@tabler/icons-svelte/icons/eye";
	import PencilSimple from "phosphor-svelte/lib/PencilSimple";
	import BookOpenText from "phosphor-svelte/lib/BookOpenText";
	import { ProjectLetterBadge } from "../project-letter-badge/index.js";
	import { DiffPill } from "../diff-pill/index.js";
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

	function getDisplayModeIcon(modeId: string) {
		if (modeId === "rendered") return IconEye;
		if (modeId === "structured") return IconListTree;
		if (modeId === "table") return IconTable;
		return IconCode;
	}

	function getEditorModeIcon(modeId: string) {
		if (modeId === "write") return PencilSimple;
		return BookOpenText;
	}
</script>

<EmbeddedPanelHeader>
	{#if !compact}
		{#if !hideProjectBadge}
			<HeaderCell>
				{#snippet children()}
					<div class="inline-flex items-center justify-center h-7 w-7 shrink-0">
						<ProjectLetterBadge
							name={projectName}
							color={projectColor}
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
					{@const ModeIcon = getDisplayModeIcon(item.id)}
					<button
						type="button"
						onclick={() => onDisplayModeChange?.(item.id)}
						class="h-7 inline-flex items-center gap-1.5 px-3 text-xs font-medium border-l border-border/50 first:border-l-0 transition-colors {activeDisplayMode ===
						item.id
							? 'bg-background text-foreground'
							: 'text-muted-foreground hover:text-foreground hover:bg-accent/40'}"
						data-header-control
					>
						<ModeIcon class="h-4 w-4" />
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
					{@const ModeIcon = getEditorModeIcon(item.id)}
					<button
						type="button"
						onclick={() => onEditorModeChange?.(item.id)}
						class="h-7 inline-flex items-center gap-1.5 px-3 text-xs font-medium border-l border-border/50 first:border-l-0 transition-colors {(activeEditorMode ??
						'') === item.id
							? 'bg-background text-foreground'
							: 'text-muted-foreground hover:text-foreground hover:bg-accent/40'}"
						data-header-control
					>
						<ModeIcon class="h-4 w-4" weight="fill" />
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
