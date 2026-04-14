<script lang="ts">
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import { mergeProps } from "bits-ui";
import { ArrowCounterClockwise } from "phosphor-svelte";
import { DotsThreeVertical } from "phosphor-svelte";
import { Palette } from "phosphor-svelte";
import { Rows } from "phosphor-svelte";
import { Trash } from "phosphor-svelte";
import { TreeView } from "phosphor-svelte";
import * as Popover from "$lib/components/ui/popover/index.js";
import * as Tooltip from "$lib/components/ui/tooltip/index.js";
import * as m from "$lib/messages.js";

import { COLOR_NAMES, Colors } from "../utils/colors.js";
import { PROJECT_COLOR_OPTIONS } from "../utils/project-color-options.js";

type ProjectViewMode = "sessions" | "files";

interface Props {
	projectName: string;
	currentColor?: string;
	currentViewMode?: ProjectViewMode;
	onColorChange?: (color: string) => void;
	onViewModeChange?: (mode: ProjectViewMode) => void;
	hasProjectIcon?: boolean;
	onResetProjectIcon?: () => void;
	onRemoveProject?: () => void;
}

let {
	projectName,
	currentColor,
	currentViewMode = "sessions",
	onColorChange,
	onViewModeChange,
	hasProjectIcon = false,
	onResetProjectIcon,
	onRemoveProject,
}: Props = $props();

let menuOpen = $state(false);
let showRemoveConfirm = $state(false);
let triggerRef: HTMLButtonElement | undefined = $state();
const colorOptions = PROJECT_COLOR_OPTIONS;

function handleColorSelect(colorName: string) {
	onColorChange?.(colorName);
}

const selectedColorHex = $derived.by(() => {
	const selectedOption = colorOptions.find(
		(option) => currentColor === option.name || currentColor === option.hex
	);
	return selectedOption?.hex ?? colorOptions[0]?.hex ?? Colors[COLOR_NAMES.RED];
});

const hasResetProjectIcon = $derived(Boolean(hasProjectIcon && onResetProjectIcon));
const showColorPicker = $derived(Boolean(onColorChange && !hasProjectIcon));
const showSettingsSection = $derived(
	Boolean(showColorPicker || onViewModeChange || onRemoveProject || hasResetProjectIcon)
);
const displaySectionClass = $derived(
	`px-2 py-1.5${showColorPicker || onRemoveProject || hasResetProjectIcon
		? " border-b border-border/20"
		: ""}`
);
const colorTriggerClass = $derived(
	`rounded-none px-2 py-1.5 text-[11px]${onRemoveProject || hasResetProjectIcon
		? " border-b border-border/20"
		: ""}`
);

function handleRemoveClick() {
	menuOpen = false;
	showRemoveConfirm = true;
}

function handleViewModeSelect(mode: ProjectViewMode) {
	onViewModeChange?.(mode);
	menuOpen = false;
}
</script>

<DropdownMenu.Root bind:open={menuOpen}>
	<Tooltip.Root>
		<Tooltip.Trigger>
			{#snippet child({ props: tooltipProps })}
				<DropdownMenu.Trigger>
					{#snippet child({ props: dropdownProps })}
						{@const props = mergeProps(tooltipProps, dropdownProps)}
						<button
							{...props}
							bind:this={triggerRef}
							type="button"
							class="flex items-center justify-center size-6 min-w-0 shrink-0 rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
							aria-label="Project menu"
						>
							<DotsThreeVertical class="h-4 w-4" weight="bold" />
						</button>
					{/snippet}
				</DropdownMenu.Trigger>
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content side="bottom">Project menu</Tooltip.Content>
	</Tooltip.Root>
	<DropdownMenu.Content align="end" side="bottom" class="min-w-[200px] p-0 text-[11px]">
		{#if showSettingsSection}
			<DropdownMenu.Group>
				<DropdownMenu.GroupHeading
					class="px-2 py-1 text-[11px] font-semibold text-muted-foreground border-b border-border/20"
				>
					Settings
				</DropdownMenu.GroupHeading>
				{#if onViewModeChange}
					<div class={displaySectionClass}>
						<div class="px-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/60">
							Display
						</div>
						<div class="mt-1 flex rounded-md bg-muted/50 p-0.5" role="group" aria-label="Display">
							<button
								type="button"
								class="flex h-6 flex-1 cursor-pointer items-center justify-center gap-1 rounded px-2 text-[11px] transition-colors {currentViewMode === 'sessions'
									? 'bg-background text-foreground shadow-sm'
									: 'text-muted-foreground hover:bg-background/60 hover:text-foreground'}"
								aria-pressed={currentViewMode === "sessions"}
								onclick={() => handleViewModeSelect("sessions")}
							>
								<Rows class="h-3.5 w-3.5" weight="fill" />
								{m.sidebar_view_sessions()}
							</button>
							<button
								type="button"
								class="flex h-6 flex-1 cursor-pointer items-center justify-center gap-1 rounded px-2 text-[11px] transition-colors {currentViewMode === 'files'
									? 'bg-background text-foreground shadow-sm'
									: 'text-muted-foreground hover:bg-background/60 hover:text-foreground'}"
								aria-pressed={currentViewMode === "files"}
								onclick={() => handleViewModeSelect("files")}
							>
								<TreeView class="h-3.5 w-3.5" weight="fill" />
								{m.sidebar_view_files()}
							</button>
						</div>
					</div>
				{/if}
				{#if onColorChange && !hasProjectIcon}
					<DropdownMenu.Sub>
						<DropdownMenu.SubTrigger class={colorTriggerClass}>
							<Palette class="h-3.5 w-3.5 mr-2" weight="fill" />
							<span class="flex-1">{m.project_color()}</span>
							<span
								class="h-3.5 w-3.5 rounded-full border border-border shrink-0"
								style="background-color: {selectedColorHex};"
								aria-hidden="true"
							></span>
						</DropdownMenu.SubTrigger>
						<DropdownMenu.SubContent class="w-auto p-1.5">
							<div class="grid grid-cols-4 gap-1">
								{#each colorOptions as option (option.name)}
									{@const isSelected = currentColor === option.name || currentColor === option.hex}
									<Tooltip.Root>
										<Tooltip.Trigger>
											<button
												type="button"
												class="h-6 w-6 rounded-full border-2 transition-all hover:scale-110 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 cursor-pointer"
												style="background-color: {option.hex}; border-color: {isSelected
													? 'white'
													: 'transparent'};"
												onclick={() => handleColorSelect(option.name)}
											>
												<span class="sr-only">{option.label()}</span>
											</button>
										</Tooltip.Trigger>
										<Tooltip.Content>
											{option.label()}
										</Tooltip.Content>
									</Tooltip.Root>
								{/each}
							</div>
						</DropdownMenu.SubContent>
					</DropdownMenu.Sub>
				{/if}
				{#if hasProjectIcon && onResetProjectIcon}
					<DropdownMenu.Item
						class="rounded-none px-2 py-1.5 text-[11px]"
						onclick={() => {
							onResetProjectIcon();
							menuOpen = false;
						}}
					>
						<ArrowCounterClockwise class="h-3.5 w-3.5 mr-2" weight="bold" />
						Reset to letter badge
					</DropdownMenu.Item>
				{/if}
				{#if onRemoveProject}
					<DropdownMenu.Item
						class="text-destructive focus:text-destructive rounded-none px-2 py-1.5 text-[11px]"
						onclick={handleRemoveClick}
					>
						<Trash class="h-3.5 w-3.5 mr-2" weight="fill" />
						{m.project_remove()}
					</DropdownMenu.Item>
				{/if}
			</DropdownMenu.Group>
		{/if}
	</DropdownMenu.Content>
</DropdownMenu.Root>

<Popover.Root bind:open={showRemoveConfirm}>
	<Popover.Content
		align="start"
		customAnchor={triggerRef}
		class="w-44 p-0 overflow-hidden"
		onInteractOutside={() => (showRemoveConfirm = false)}
	>
		<div class="px-2 py-2">
			<p class="text-[11px] font-medium">{m.project_remove_confirm_title()}</p>
			<p class="text-[10px] text-muted-foreground leading-snug mt-0.5">
				{m.project_remove_confirm_description({ projectName })}
			</p>
		</div>
		<div class="flex items-stretch border-t border-border/30">
			<button
				type="button"
				class="flex-1 flex items-center justify-center px-2 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer border-r border-border/30"
				onclick={() => (showRemoveConfirm = false)}
			>
				{m.common_cancel()}
			</button>
			<button
				type="button"
				class="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-[11px] font-medium text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
				onclick={() => {
					onRemoveProject?.();
					showRemoveConfirm = false;
				}}
			>
				<Trash class="size-3" weight="fill" />
				{m.common_delete()}
			</button>
		</div>
	</Popover.Content>
</Popover.Root>
