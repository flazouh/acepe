<script lang="ts">
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import { mergeProps } from "bits-ui";
import { ArrowCounterClockwise } from "phosphor-svelte";
import { ArrowDown } from "phosphor-svelte";
import { ArrowUp } from "phosphor-svelte";
import { DotsThreeVertical } from "phosphor-svelte";
import { ImageSquare } from "phosphor-svelte";
import { Palette } from "phosphor-svelte";
import { Trash } from "phosphor-svelte";
import * as Popover from "$lib/components/ui/popover/index.js";
import * as Tooltip from "$lib/components/ui/tooltip/index.js";
import { PROJECT_COLOR_OPTIONS } from "../utils/project-color-options.js";
import { buildProjectHeaderOverflowMenuState } from "./project-menu-state.js";

interface Props {
	projectName: string;
	currentColor?: string;
	onColorChange?: (color: string) => void;
	/** When set, shows "Reset to letter badge" and hides color picker */
	projectIconSrc?: string | null;
	onResetProjectIcon?: () => void;
	onRemoveProject?: () => void;
	onMoveUp?: () => void;
	onMoveDown?: () => void;
	moveUpDisabled?: boolean;
	moveDownDisabled?: boolean;
	onChangeProjectIcon?: () => void;
}

let {
	projectName,
	currentColor,
	onColorChange,
	projectIconSrc = null,
	onResetProjectIcon,
	onRemoveProject,
	onMoveUp,
	onMoveDown,
	moveUpDisabled = false,
	moveDownDisabled = false,
	onChangeProjectIcon,
}: Props = $props();

let menuOpen = $state(false);
let showRemoveConfirm = $state(false);
let triggerRef: HTMLButtonElement | undefined = $state();
const colorOptions = PROJECT_COLOR_OPTIONS;

function handleColorSelect(colorName: string) {
	onColorChange?.(colorName);
}

const menuState = $derived(
	buildProjectHeaderOverflowMenuState({
		currentColor,
		colorOptions,
		projectIconSrc,
		hasColorChange: Boolean(onColorChange),
		hasResetProjectIconAction: Boolean(onResetProjectIcon),
		hasRemoveProjectAction: Boolean(onRemoveProject),
		hasChangeProjectIconAction: Boolean(onChangeProjectIcon),
	})
);
const selectedColorHex = $derived(menuState.selectedColorHex);
const hasIcon = $derived(menuState.hasIcon);
const hasResetProjectIcon = $derived(menuState.hasResetProjectIcon);
const showColorPicker = $derived(menuState.showColorPicker);
const showSettingsSection = $derived(menuState.showSettingsSection);
const displaySectionClass = $derived(menuState.displaySectionClass);
const colorTriggerClass = $derived(menuState.colorTriggerClass);

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
							class="flex items-center justify-center size-5 min-w-0 shrink-0 rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
							aria-label="Project menu"
						>
							<DotsThreeVertical class="h-3.5 w-3.5" weight="bold" />
						</button>
					{/snippet}
				</DropdownMenu.Trigger>
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content side="bottom">Project menu</Tooltip.Content>
	</Tooltip.Root>
	<DropdownMenu.Content align="end" side="bottom" class="min-w-[200px] p-0 text-[11px]">
		{#if onMoveUp || onMoveDown}
			<DropdownMenu.Group>
				<DropdownMenu.Item
					class="rounded-none px-2 py-1.5 text-[11px]"
					disabled={moveUpDisabled}
					onclick={() => {
						onMoveUp?.();
						menuOpen = false;
					}}
				>
					<ArrowUp class="h-3.5 w-3.5 mr-2" weight="bold" />
					Move Up
				</DropdownMenu.Item>
				<DropdownMenu.Item
					class="rounded-none px-2 py-1.5 text-[11px] border-b border-border/20"
					disabled={moveDownDisabled}
					onclick={() => {
						onMoveDown?.();
						menuOpen = false;
					}}
				>
					<ArrowDown class="h-3.5 w-3.5 mr-2" weight="bold" />
					Move Down
				</DropdownMenu.Item>
			</DropdownMenu.Group>
		{/if}
		{#if showSettingsSection}
			<DropdownMenu.Group>
				<DropdownMenu.GroupHeading
					class="px-2 py-1 text-[11px] font-semibold text-muted-foreground border-b border-border/20"
				>
					Settings
				</DropdownMenu.GroupHeading>
				{#if onChangeProjectIcon}
					<DropdownMenu.Item
						class="rounded-none px-2 py-1.5 text-[11px]"
						onclick={() => {
							onChangeProjectIcon();
							menuOpen = false;
						}}
					>
						<ImageSquare class="h-3.5 w-3.5 mr-2" weight="fill" />
						Change icon...
					</DropdownMenu.Item>
				{/if}
				{#if onColorChange && !hasIcon}
					<DropdownMenu.Sub>
						<DropdownMenu.SubTrigger class={colorTriggerClass}>
							<Palette class="h-3.5 w-3.5 mr-2" weight="fill" />
							<span class="flex-1">{"Color"}</span>
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
				{#if hasIcon && onResetProjectIcon}
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
						{"Remove Project"}
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
			<p class="text-[11px] font-medium">{"Remove Project"}</p>
			<p class="text-[10px] text-muted-foreground leading-snug mt-0.5">
				{`Remove "${projectName}" from your workspace? This will not delete any files.`}
			</p>
		</div>
		<div class="flex items-stretch border-t border-border/30">
			<button
				type="button"
				class="flex-1 flex items-center justify-center px-2 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer border-r border-border/30"
				onclick={() => (showRemoveConfirm = false)}
			>
				{"Cancel"}
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
				{"Delete"}
			</button>
		</div>
	</Popover.Content>
</Popover.Root>
