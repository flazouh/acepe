<script lang="ts">
import { HugeiconsIcon, Selector } from "@acepe/ui";
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import { LoadingIcon } from "@acepe/ui";
import { ThemeToggle } from "$lib/components/theme/index.js";
import { fontSizeSettingsStore } from "$lib/stores/font-size-settings-store.svelte.js";
import { loadingIndicatorSettingsStore } from "$lib/stores/loading-indicator-settings-store.svelte.js";
import SettingRow from "../setting-row.svelte";
import SettingsSection from "../settings-section.svelte";

const selectedColorOption = $derived(
	loadingIndicatorSettingsStore.colorOptions.find(
		(option) => option.id === loadingIndicatorSettingsStore.selectedColor
	)
);

function handleColorChange(value: string): void {
	void loadingIndicatorSettingsStore.setColor(value);
}

const uiBounds = fontSizeSettingsStore.uiBounds;
const codeBounds = fontSizeSettingsStore.codeBounds;
</script>

{#snippet fontStepper(
	value: number,
	min: number,
	max: number,
	step: number,
	onChange: (next: number) => void,
	label: string
)}
	<div class="flex items-center gap-0.5 rounded-md border border-border/60 bg-card p-0.5">
		<button
			type="button"
			aria-label={`Decrease ${label}`}
			disabled={value <= min}
			onclick={() => onChange(value - step)}
			class="inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
		>
			<HugeiconsIcon name="minus" class="size-3" />
		</button>
		<span class="w-9 text-center text-[13px] font-medium tabular-nums text-foreground">{value}</span>
		<button
			type="button"
			aria-label={`Increase ${label}`}
			disabled={value >= max}
			onclick={() => onChange(value + step)}
			class="inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
		>
			<HugeiconsIcon name="plus" class="size-3" />
		</button>
	</div>
{/snippet}

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
			description="Use the Hugeicons spinner consistently across Acepe."
		>
			<LoadingIcon size={16} class="animate-spin" aria-label="Hugeicons spinner" />
		</SettingRow>
		<SettingRow
			label={"Loading indicator color"}
			description="Pick a Tailwind color for the animation."
		>
			<Selector align="start" variant="outline" triggerSize="pill" class="w-[220px]">
				{#snippet renderButton()}
					<span class="flex items-center gap-1.5 min-w-0 flex-1">
						<span
							class="inline-block size-3.5 rounded-full border border-border/50"
							style="background-color: {selectedColorOption?.hex ?? '#bf8700'};"
							aria-hidden="true"
						></span>
						<span class="truncate">{selectedColorOption?.label ?? ""}</span>
					</span>
				{/snippet}

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
			</Selector>
		</SettingRow>
	</SettingsSection>

	<SettingsSection
		title="Typography"
		description="Adjust how large text appears across the app."
	>
		<SettingRow
			label={"Interface font size"}
			description="Base font size for the app. Scales menus, panels, and chat text."
		>
			{@render fontStepper(
				fontSizeSettingsStore.uiFontSize,
				uiBounds.MIN,
				uiBounds.MAX,
				uiBounds.STEP,
				(next) => void fontSizeSettingsStore.setUiFontSize(next),
				"interface font size"
			)}
		</SettingRow>
		<SettingRow
			label={"Code font size"}
			description="Font size for code blocks and diffs."
		>
			{@render fontStepper(
				fontSizeSettingsStore.codeFontSize,
				codeBounds.MIN,
				codeBounds.MAX,
				codeBounds.STEP,
				(next) => void fontSizeSettingsStore.setCodeFontSize(next),
				"code font size"
			)}
		</SettingRow>
	</SettingsSection>
</div>
