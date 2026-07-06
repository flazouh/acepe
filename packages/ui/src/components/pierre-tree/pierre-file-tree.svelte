<script lang="ts">
import type { FileTreeDensity, FileTreeInitialExpansion } from "@pierre/trees";

import * as DropdownMenu from "../dropdown-menu/index.js";
import { RoundedIcon } from "../icons/index.js";
import { Selector } from "../selector/index.js";
import { selectorPanelItemClass } from "../selector/selector-panel.classes.js";
import { createPierreFileTreeAttachment } from "./pierre-file-tree-attachment.svelte.js";
import type { PierreFileTreeProps } from "./pierre-file-tree-types.js";
import { cn } from "../../lib/utils.js";

type DensityOption = {
	value: FileTreeDensity;
	label: string;
	title: string;
};

const DENSITY_OPTIONS: readonly DensityOption[] = [
	{ value: "compact", label: "Dense", title: "Compact density" },
	{ value: "default", label: "Normal", title: "Default density" },
	{ value: "relaxed", label: "Loose", title: "Relaxed density" },
];

let {
	paths,
	selectedPath = null,
	selectedPaths,
	onSelectionChange,
	gitStatus,
	icons,
	rowActions,
	rowDecoration,
	contextMenuTriggerMode = "both",
	contextMenuButtonVisibility = "when-needed",
	initialExpansion,
	initialExpandedPaths,
	flattenEmptyDirectories = true,
	density,
	itemHeight,
	overscan,
	stickyFolders,
	revealPath = null,
	unsafeCSS,
	id,
	class: className,
	testId = "pierre-file-tree",
	ariaLabel = "File tree",
	showControls = true,
}: PierreFileTreeProps = $props();

let settingsOpen = $state(false);
let controlsDensity = $state<FileTreeDensity>("compact");
let controlsExpansion = $state<FileTreeInitialExpansion>("closed");
let controlsExpansionRevision = $state(0);

const effectiveDensity = $derived(density ?? controlsDensity);
const effectiveInitialExpansion = $derived(
	initialExpansion ?? controlsExpansion,
);
const canControlDensity = $derived(density === undefined);
const canControlExpansion = $derived(initialExpansion === undefined);
const treeRenderKey = $derived(
	`${effectiveInitialExpansion}:${controlsExpansionRevision}:${effectiveDensity}`,
);

function updateControlsExpansion(
	nextExpansion: FileTreeInitialExpansion,
): void {
	controlsExpansion = nextExpansion;
	controlsExpansionRevision += 1;
}

const attachPierreFileTree = createPierreFileTreeAttachment(() => ({
	paths,
	selectedPath,
	selectedPaths,
	onSelectionChange,
	gitStatus,
	icons,
	rowActions,
	rowDecoration,
	contextMenuTriggerMode,
	contextMenuButtonVisibility,
	initialExpansion: effectiveInitialExpansion,
	initialExpandedPaths,
	flattenEmptyDirectories,
	density: effectiveDensity,
	itemHeight,
	overscan,
	stickyFolders,
	revealPath,
	unsafeCSS,
	id,
	class: className,
	testId,
	ariaLabel,
}));
</script>

<div class={cn("pierre-file-tree-shell flex h-full min-h-0 flex-col overflow-hidden", className)}>
	{#if showControls}
		<div class="pierre-file-tree-settings">
			<Selector
				bind:open={settingsOpen}
				align="end"
				side="bottom"
				sideOffset={4}
				showChevron={false}
				triggerSize="chromeIcon"
				variant="ghost"
				triggerActive={settingsOpen}
				triggerAriaLabel={`${ariaLabel} settings`}
				contentClass="w-44 max-w-[11rem] !max-h-none"
			>
				{#snippet renderButton()}
					<RoundedIcon name="settings" />
				{/snippet}

				<DropdownMenu.Group>
					<DropdownMenu.GroupHeading>Density</DropdownMenu.GroupHeading>
					{#each DENSITY_OPTIONS as option (option.value)}
						<DropdownMenu.Item
							class="{selectorPanelItemClass} flex items-center gap-2 text-xs"
							data-pierre-tree-control={`density-${option.value}`}
							aria-label={option.title}
							title={option.title}
							disabled={!canControlDensity}
							onSelect={() => {
								controlsDensity = option.value;
								settingsOpen = false;
							}}
						>
							<span class="min-w-0 flex-1 truncate">{option.label}</span>
							{#if effectiveDensity === option.value}
								<RoundedIcon name="check" class="size-3 shrink-0 text-foreground" />
							{/if}
						</DropdownMenu.Item>
					{/each}
				</DropdownMenu.Group>

				<DropdownMenu.Group>
					<DropdownMenu.GroupHeading>Expansion</DropdownMenu.GroupHeading>
					<DropdownMenu.Item
						class="{selectorPanelItemClass} flex items-center gap-2 text-xs"
						data-pierre-tree-control="collapse"
						aria-label="Collapse all"
						title="Collapse all"
						disabled={!canControlExpansion}
						onSelect={() => {
							updateControlsExpansion("closed");
							settingsOpen = false;
						}}
					>
						<RoundedIcon name="collapse" class="size-3 shrink-0 text-muted-foreground" />
						<span class="min-w-0 flex-1 truncate">Collapse all</span>
						{#if effectiveInitialExpansion === "closed"}
							<RoundedIcon name="check" class="size-3 shrink-0 text-foreground" />
						{/if}
					</DropdownMenu.Item>
					<DropdownMenu.Item
						class="{selectorPanelItemClass} flex items-center gap-2 text-xs"
						data-pierre-tree-control="expand"
						aria-label="Expand all"
						title="Expand all"
						disabled={!canControlExpansion}
						onSelect={() => {
							updateControlsExpansion("open");
							settingsOpen = false;
						}}
					>
						<RoundedIcon name="expand" class="size-3 shrink-0 text-muted-foreground" />
						<span class="min-w-0 flex-1 truncate">Expand all</span>
						{#if effectiveInitialExpansion === "open"}
							<RoundedIcon name="check" class="size-3 shrink-0 text-foreground" />
						{/if}
					</DropdownMenu.Item>
				</DropdownMenu.Group>
			</Selector>
		</div>
	{/if}

	{#key treeRenderKey}
		<div
			class="pierre-file-tree min-h-0 flex-1 overflow-hidden"
			data-pierre-tree-host=""
			data-testid={testId}
			aria-label={ariaLabel}
			{@attach attachPierreFileTree}
		></div>
	{/key}
</div>

<style>
	.pierre-file-tree-shell {
		--trees-bg-override: transparent;
		--trees-bg-muted-override: hsl(var(--muted) / 0.55);
		--trees-fg-override: hsl(var(--foreground));
		--trees-input-bg-override: transparent;
		--trees-muted-fg-override: hsl(var(--muted-foreground));
		--trees-selected-bg-override: hsl(var(--muted) / 0.6);
		--trees-border-color-override: hsl(var(--border));
		background: transparent;
		position: relative;
	}

	.pierre-file-tree {
		--trees-bg-override: transparent;
		--trees-bg-muted-override: hsl(var(--muted) / 0.55);
		--trees-fg-override: hsl(var(--foreground));
		--trees-input-bg-override: transparent;
		--trees-muted-fg-override: hsl(var(--muted-foreground));
		--trees-selected-bg-override: hsl(var(--muted) / 0.6);
		--trees-border-color-override: hsl(var(--border));
		background: transparent;
	}

	.pierre-file-tree-settings {
		position: absolute;
		right: 2px;
		top: 2px;
		z-index: 10;
	}
</style>
