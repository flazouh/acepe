<script lang="ts">
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import { Gear } from "phosphor-svelte";
import { Palette } from "phosphor-svelte";
import { Trash } from "phosphor-svelte";
import * as Popover from "$lib/components/ui/popover/index.js";
import * as Tooltip from "$lib/components/ui/tooltip/index.js";
import * as m from "$lib/messages.js";

import { COLOR_NAMES, Colors } from "../utils/colors.js";
import { PROJECT_COLOR_OPTIONS } from "../utils/project-color-options.js";

interface Props {
	projectName?: string;
	currentColor?: string;
	onColorChange?: (color: string) => void;
	onRemoveProject?: () => void;
}

let { projectName = "", currentColor, onColorChange, onRemoveProject }: Props = $props();

let showRemoveConfirm = $state(false);
let dropdownOpen = $state(false);
let gearButtonRef: HTMLButtonElement | undefined = $state();
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
</script>

<DropdownMenu.Root bind:open={dropdownOpen}>
	<Tooltip.Root>
		<Tooltip.Trigger>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<button
						{...props}
						bind:this={gearButtonRef}
						class="inline-flex items-center justify-center h-7 w-7 cursor-pointer text-muted-foreground hover:bg-accent hover:text-primary transition-colors *:transition-transform *:duration-200 hover:*:rotate-45"
					>
						<Gear class="h-3 w-3" weight="fill" />
					</button>
				{/snippet}
			</DropdownMenu.Trigger>
		</Tooltip.Trigger>
		<Tooltip.Content>
			{m.project_settings()}
		</Tooltip.Content>
	</Tooltip.Root>
	<DropdownMenu.Content align="start" class="w-44">
		<DropdownMenu.Sub>
			<DropdownMenu.SubTrigger>
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

		<!-- Remove Project Section -->
		{#if onRemoveProject}
			<DropdownMenu.Separator />
			<DropdownMenu.Item
				class="text-destructive focus:text-destructive"
				onclick={() => {
					dropdownOpen = false;
					showRemoveConfirm = true;
				}}
			>
				<Trash class="h-3.5 w-3.5 mr-2" weight="fill" />
				{m.project_remove()}
			</DropdownMenu.Item>
		{/if}
	</DropdownMenu.Content>
</DropdownMenu.Root>

<!-- Remove confirmation popover (outside dropdown to avoid animation/bg issues) -->
<Popover.Root bind:open={showRemoveConfirm}>
	<Popover.Content
		align="start"
		customAnchor={gearButtonRef}
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
