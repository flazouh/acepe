<script lang="ts">
import { HugeiconsIcon, Selector } from "@acepe/ui";
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import { LoadingIcon } from "@acepe/ui";
import { useTheme } from "$lib/components/theme/context.svelte.js";
import { uiThemeFamilies } from "@acepe/ui/themes";
import { uiThemeFamilyStore } from "$lib/stores/ui-theme-family-store.svelte.js";
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

/**
 * "System" is a real answer here, not a third colour: it follows the OS. Its
 * icon is the machine rather than a sun or a moon for that reason.
 */
const THEME_OPTIONS = [
	{ id: "light", label: "Light", icon: "sun" },
	{ id: "dark", label: "Dark", icon: "moon" },
	{ id: "system", label: "System", icon: "laptop" },
] as const;

const themeState = useTheme();

const selectedThemeOption = $derived(
	THEME_OPTIONS.find((option) => option.id === themeState.theme) ?? THEME_OPTIONS[2]
);

function handleThemeChange(value: string): void {
	themeState.setTheme(value as (typeof THEME_OPTIONS)[number]["id"]);
}

const selectedFamily = $derived(
	uiThemeFamilies.find((family) => family.id === uiThemeFamilyStore.familyId)
);

function handleFamilyChange(value: string): void {
	uiThemeFamilyStore.setFamily(value as (typeof uiThemeFamilies)[number]["id"]);
}

const uiBounds = fontSizeSettingsStore.uiBounds;
const codeBounds = fontSizeSettingsStore.codeBounds;
</script>

<!--
	The palette's own background in light and dark, split down the middle. A
	single colour cannot preview a palette that ships both, and this is the one
	swatch that reads correctly whichever theme the app is currently in.
-->
{#snippet paletteSwatch(familyId: string, size: number)}
	<span
		class="inline-flex shrink-0 overflow-hidden rounded-full border border-border/60"
		style={`width:${size}px;height:${size}px`}
		aria-hidden="true"
	>
		<!--
			Every band carries data-ui-theme itself. theme.css scopes the dark
			values to `[data-ui-theme="x"].dark`, so the attribute and the class
			have to sit on the SAME element; the previous markup put the attribute
			on the wrapper and `.dark` on the child, and the dark half quietly
			rendered the light background instead.

			Three bands, not two: Acepe and Anthropic ship identical backgrounds
			(#f7f7f7 / #121212) and differ in their primary, so a background-only
			swatch showed those two palettes as the same picture.
		-->
		<span data-ui-theme={familyId} class="w-1/3 bg-background"></span>
		<span data-ui-theme={familyId} class="w-1/3 bg-primary"></span>
		<span data-ui-theme={familyId} class="dark w-1/3 bg-background"></span>
	</span>
{/snippet}

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
			<Selector align="start" variant="outline" triggerSize="pill" class="w-[220px]">
				{#snippet renderButton()}
					<span class="flex min-w-0 flex-1 items-center gap-1.5">
						<HugeiconsIcon name={selectedThemeOption.icon} class="size-3.5 shrink-0" />
						<span class="truncate">{selectedThemeOption.label}</span>
					</span>
				{/snippet}

				<DropdownMenu.RadioGroup
					value={themeState.theme}
					onValueChange={handleThemeChange}
				>
					{#each THEME_OPTIONS as option (option.id)}
						<DropdownMenu.RadioItem value={option.id}>
							<span class="flex items-center gap-2">
								<HugeiconsIcon name={option.icon} class="size-4 shrink-0" />
								<span>{option.label}</span>
							</span>
						</DropdownMenu.RadioItem>
					{/each}
				</DropdownMenu.RadioGroup>
			</Selector>
		</SettingRow>
		<SettingRow
			label={"Palette"}
			description="Which colour set the app paints. Light and dark come with each one."
		>
			<Selector align="start" variant="outline" triggerSize="pill" class="w-[220px]">
				{#snippet renderButton()}
					<span class="flex min-w-0 flex-1 items-center gap-1.5">
						{@render paletteSwatch(uiThemeFamilyStore.familyId, 14)}
						<span class="truncate">{selectedFamily?.label ?? ""}</span>
					</span>
				{/snippet}

				<DropdownMenu.RadioGroup
					value={uiThemeFamilyStore.familyId}
					onValueChange={handleFamilyChange}
				>
					{#each uiThemeFamilies as family (family.id)}
						<DropdownMenu.RadioItem value={family.id}>
							<span class="flex items-center gap-2">
								{@render paletteSwatch(family.id, 16)}
								<span>{family.label}</span>
							</span>
						</DropdownMenu.RadioItem>
					{/each}
				</DropdownMenu.RadioGroup>
			</Selector>
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
