<script lang="ts">
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import { LoadingIcon } from "@acepe/ui";
import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
import { ThemeToggle } from "$lib/components/theme/index.js";
import { loadingIndicatorSettingsStore } from "$lib/stores/loading-indicator-settings-store.svelte.js";
import SettingRow from "../setting-row.svelte";
import SettingsSection from "../settings-section.svelte";

const selectedVariantOption = $derived(
	loadingIndicatorSettingsStore.options.find(
		(option) => option.id === loadingIndicatorSettingsStore.selectedVariant
	)
);

const selectedColorOption = $derived(
	loadingIndicatorSettingsStore.colorOptions.find(
		(option) => option.id === loadingIndicatorSettingsStore.selectedColor
	)
);

function handleVariantChange(value: string): void {
	void loadingIndicatorSettingsStore.setVariant(value);
}

function handleColorChange(value: string): void {
	void loadingIndicatorSettingsStore.setColor(value);
}
</script>

<div class="w-full">
	<SettingsSection>
		<SettingRow
			label={"Theme"}
			description="Use light, dark, or match your system."
		>
			<ThemeToggle />
		</SettingRow>
		<SettingRow
			label={"Loading indicator"}
			description="Choose the dot animation used across Acepe."
		>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<button
							{...props}
							class="flex items-center justify-between gap-1.5 w-[220px] h-7 px-1.5 rounded-lg border border-input bg-transparent text-xs hover:bg-accent transition-colors cursor-pointer"
						>
							<span class="flex items-center gap-1.5 min-w-0">
								<LoadingIcon
									size={16}
									variant={loadingIndicatorSettingsStore.selectedVariant}
								/>
								<span class="truncate">{selectedVariantOption?.label ?? ""}</span>
							</span>
							<ChevronDownIcon class="size-3.5 opacity-50 shrink-0" />
						</button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="start" class="w-[220px]">
					<DropdownMenu.RadioGroup
						value={loadingIndicatorSettingsStore.selectedVariant}
						onValueChange={handleVariantChange}
					>
						{#each loadingIndicatorSettingsStore.options as option (option.id)}
							<DropdownMenu.RadioItem value={option.id}>
								<span class="flex items-center gap-2">
									<LoadingIcon size={16} variant={option.id} />
									<span>{option.label}</span>
								</span>
							</DropdownMenu.RadioItem>
						{/each}
					</DropdownMenu.RadioGroup>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		</SettingRow>
		<SettingRow
			label={"Loading indicator color"}
			description="Pick a Tailwind color for the animation."
		>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<button
							{...props}
							class="flex items-center justify-between gap-1.5 w-[220px] h-7 px-1.5 rounded-lg border border-input bg-transparent text-xs hover:bg-accent transition-colors cursor-pointer"
						>
							<span class="flex items-center gap-1.5 min-w-0">
								<span
									class="inline-block size-3.5 rounded-full border border-border/50"
									style="background-color: {selectedColorOption?.hex ?? '#bf8700'};"
									aria-hidden="true"
								></span>
								<span class="truncate">{selectedColorOption?.label ?? ""}</span>
							</span>
							<ChevronDownIcon class="size-3.5 opacity-50 shrink-0" />
						</button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="start" class="w-[220px]">
					<DropdownMenu.RadioGroup
						value={loadingIndicatorSettingsStore.selectedColor}
						onValueChange={handleColorChange}
					>
						{#each loadingIndicatorSettingsStore.colorOptions as option (option.id)}
							<DropdownMenu.RadioItem value={option.id}>
								<span class="flex items-center gap-2">
									<span
										class="inline-block size-4 rounded-full border border-border/50"
										style="background-color: {option.hex};"
										aria-hidden="true"
									></span>
									<span>{option.label}</span>
								</span>
							</DropdownMenu.RadioItem>
						{/each}
					</DropdownMenu.RadioGroup>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		</SettingRow>
	</SettingsSection>
</div>
