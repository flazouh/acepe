<script lang="ts">
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import { mergeProps } from "bits-ui";
import DotsThreeVertical from "phosphor-svelte/lib/DotsThreeVertical";
import Globe from "phosphor-svelte/lib/Globe";
import Palette from "phosphor-svelte/lib/Palette";
import Rows from "phosphor-svelte/lib/Rows";
import Terminal from "phosphor-svelte/lib/Terminal";
import Trash from "phosphor-svelte/lib/Trash";
import TreeView from "phosphor-svelte/lib/TreeView";
import * as Popover from "$lib/components/ui/popover/index.js";
import * as Tooltip from "$lib/components/ui/tooltip/index.js";
import * as m from "$lib/paraglide/messages.js";

import { COLOR_NAMES, Colors } from "../utils/colors.js";

type ProjectViewMode = "sessions" | "files";

interface Props {
	projectName: string;
	currentColor?: string;
	viewMode: ProjectViewMode;
	onViewModeChange: (mode: ProjectViewMode) => void;
	onOpenTerminal?: () => void;
	onOpenBrowser?: () => void;
	onColorChange?: (color: string) => void;
	onRemoveProject?: () => void;
}

let {
	projectName,
	currentColor,
	viewMode,
	onViewModeChange,
	onOpenTerminal,
	onOpenBrowser,
	onColorChange,
	onRemoveProject,
}: Props = $props();

let menuOpen = $state(false);
let showRemoveConfirm = $state(false);
let triggerRef: HTMLButtonElement | undefined = $state();

const colorOptions = [
	{ name: COLOR_NAMES.RED, hex: Colors[COLOR_NAMES.RED], label: () => m.project_color_red() },
	{
		name: COLOR_NAMES.ORANGE,
		hex: Colors[COLOR_NAMES.ORANGE],
		label: () => m.project_color_orange(),
	},
	{
		name: COLOR_NAMES.YELLOW,
		hex: Colors[COLOR_NAMES.YELLOW],
		label: () => m.project_color_yellow(),
	},
	{
		name: COLOR_NAMES.GREEN,
		hex: Colors[COLOR_NAMES.GREEN],
		label: () => m.project_color_green(),
	},
	{ name: COLOR_NAMES.CYAN, hex: Colors[COLOR_NAMES.CYAN], label: () => m.project_color_cyan() },
	{
		name: COLOR_NAMES.PURPLE,
		hex: Colors[COLOR_NAMES.PURPLE],
		label: () => m.project_color_purple(),
	},
	{ name: COLOR_NAMES.PINK, hex: Colors[COLOR_NAMES.PINK], label: () => m.project_color_pink() },
];

function handleColorSelect(colorName: string) {
	onColorChange?.(colorName);
}

const selectedColorHex = $derived.by(() => {
	const selectedOption = colorOptions.find(
		(option) => currentColor === option.name || currentColor === option.hex
	);
	return selectedOption?.hex ?? colorOptions[0]?.hex ?? Colors[COLOR_NAMES.RED];
});

const showPanelsSection = $derived(Boolean(onOpenTerminal || onOpenBrowser));
const showSettingsSection = $derived(Boolean(onColorChange || onRemoveProject));

function handleOpenTerminalClick() {
	menuOpen = false;
	onOpenTerminal?.();
}

function handleOpenBrowserClick() {
	menuOpen = false;
	onOpenBrowser?.();
}

function handleRemoveClick() {
	menuOpen = false;
	showRemoveConfirm = true;
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
							class="inline-flex h-7 w-7 min-w-0 shrink-0 cursor-pointer items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
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
		<DropdownMenu.Group>
			<div
				class="flex items-center gap-2 border-b border-border/20 px-2 py-1.5"
				role="group"
				aria-label="View"
			>
				<span class="shrink-0 text-[11px] font-semibold text-muted-foreground">View</span>
				<div class="flex min-w-0 flex-1 items-stretch gap-0 rounded-md bg-muted/50">
					<button
						type="button"
						class="flex min-w-0 flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium transition-colors cursor-pointer {viewMode ===
						'sessions'
							? 'bg-muted text-foreground/80'
							: 'text-muted-foreground hover:text-foreground'}"
						onclick={() => onViewModeChange("sessions")}
					>
						<Rows class="size-3 shrink-0" weight="fill" style="color: #9858FF" />
						<span class="truncate">{m.sidebar_view_sessions()}</span>
					</button>
					<button
						type="button"
						class="flex min-w-0 flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium transition-colors cursor-pointer {viewMode ===
						'files'
							? 'bg-muted text-foreground/80'
							: 'text-muted-foreground hover:text-foreground'}"
						onclick={() => onViewModeChange("files")}
					>
						<TreeView class="size-3 shrink-0" weight="fill" style="color: #FF8D20" />
						<span class="truncate">{m.sidebar_view_files()}</span>
					</button>
				</div>
			</div>
		</DropdownMenu.Group>

		{#if showPanelsSection}
			<DropdownMenu.Group>
				<DropdownMenu.GroupHeading
					class="px-2 py-1 text-[11px] font-semibold text-muted-foreground border-b border-border/20"
				>
					Panels
				</DropdownMenu.GroupHeading>
				{#if onOpenTerminal}
					<DropdownMenu.Item
						class="cursor-pointer rounded-none border-b border-border/20 px-2 py-1.5 text-[11px]"
						onclick={handleOpenTerminalClick}
					>
						<Terminal class="size-4 shrink-0" weight="fill" />
						<span class="flex-1">Terminal</span>
					</DropdownMenu.Item>
				{/if}
				{#if onOpenBrowser}
					<DropdownMenu.Item
						class="cursor-pointer rounded-none px-2 py-1.5 text-[11px] {onOpenTerminal
							? ''
							: 'border-b border-border/20'}"
						onclick={handleOpenBrowserClick}
					>
						<Globe class="size-4 shrink-0" weight="fill" />
						<span class="flex-1">Web</span>
					</DropdownMenu.Item>
				{/if}
			</DropdownMenu.Group>
		{/if}

		{#if showSettingsSection}
			<DropdownMenu.Group>
				<DropdownMenu.GroupHeading
					class="px-2 py-1 text-[11px] font-semibold text-muted-foreground border-b border-border/20"
				>
					Settings
				</DropdownMenu.GroupHeading>
				{#if onColorChange}
					<DropdownMenu.Sub>
						<DropdownMenu.SubTrigger class="rounded-none border-b border-border/20 px-2 py-1.5 text-[11px]">
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
