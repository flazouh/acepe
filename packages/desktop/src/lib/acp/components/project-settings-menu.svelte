<script lang="ts">
import { Selector } from "@acepe/ui";
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import { Gear } from "phosphor-svelte";
import { Palette } from "phosphor-svelte";
import { Trash } from "phosphor-svelte";
import * as Popover from "$lib/components/ui/popover/index.js";
import * as Tooltip from "$lib/components/ui/tooltip/index.js";
import { PROJECT_COLOR_OPTIONS } from "@acepe/ui/app-layout";
import { getSelectedProjectColorHex } from "@acepe/ui/app-layout";

interface Props {
	projectName?: string;
	currentColor?: string;
	onColorChange?: (color: string) => void;
	onRemoveProject?: () => void;
}

let { projectName = "", currentColor, onColorChange, onRemoveProject }: Props = $props();

let showRemoveConfirm = $state(false);
let dropdownOpen = $state(false);
let gearButtonRef: HTMLButtonElement | null = $state(null);
const colorOptions = PROJECT_COLOR_OPTIONS;

function handleColorSelect(colorName: string) {
	onColorChange?.(colorName);
}

const selectedColorHex = $derived(getSelectedProjectColorHex({ currentColor, colorOptions }));
</script>

<Selector
	bind:open={dropdownOpen}
	bind:triggerRef={gearButtonRef}
	align="start"
	triggerSize="square"
	showChevron={false}
	tooltipLabel="Project Settings"
	variant="ghost"
>
	{#snippet renderButton()}
		<Gear class="h-3 w-3" weight="fill" />
	{/snippet}

	<DropdownMenu.Sub>
		<DropdownMenu.SubTrigger>
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
								<span class="sr-only">{option.label}</span>
							</button>
						</Tooltip.Trigger>
						<Tooltip.Content>
							{option.label}
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
			{"Remove Project"}
		</DropdownMenu.Item>
	{/if}
</Selector>

<!-- Remove confirmation popover (outside dropdown to avoid animation/bg issues) -->
<Popover.Root bind:open={showRemoveConfirm}>
	<Popover.Content
		align="start"
		customAnchor={gearButtonRef ?? undefined}
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
