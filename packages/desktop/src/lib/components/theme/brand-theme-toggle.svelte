<script lang="ts">
import { RoundedIcon, Selector } from "@acepe/ui";
import * as DropdownMenu from "@acepe/ui/dropdown-menu";

import { useTheme } from "./context.svelte.js";

const themeState = useTheme();
</script>

<!--
	Theme toggle tuned for the brand surface (onboarding + update overlay): the
	trigger icon reflects the selected theme and is tinted cream so it stays
	legible on the brand shader regardless of the active theme.
-->
{#snippet systemThemeIcon()}
	<span
		class="relative inline-flex size-4 shrink-0 items-center justify-center"
		style="color: #F8F5EE"
		data-testid="brand-theme-system-css-icon"
		aria-hidden="true"
	>
		<span class="absolute left-[3px] top-[3px] h-[9px] w-[10px] rounded-[2px] border border-current"></span>
		<span class="absolute bottom-[2px] h-px w-[6px] rounded-full bg-current"></span>
		<span class="absolute bottom-[3px] h-[3px] w-px rounded-full bg-current"></span>
	</span>
{/snippet}

<Selector
	align="end"
	variant="ghost"
	triggerSize="icon"
	showChevron={false}
	tooltipLabel="Theme"
	triggerAriaLabel="Theme"
>
	{#snippet renderButton()}
		{#if themeState.theme === "light"}
			<RoundedIcon name="sun" class="size-4" style="color: #F8F5EE" />
		{:else if themeState.theme === "dark"}
			<RoundedIcon name="moon" class="size-4" style="color: #F8F5EE" />
		{:else}
			{@render systemThemeIcon()}
		{/if}
	{/snippet}

	<DropdownMenu.CheckboxItem
		checked={themeState.theme === "light"}
		onCheckedChange={(checked) => checked && themeState.setTheme("light")}
	>
		Light
	</DropdownMenu.CheckboxItem>
	<DropdownMenu.CheckboxItem
		checked={themeState.theme === "dark"}
		onCheckedChange={(checked) => checked && themeState.setTheme("dark")}
	>
		Dark
	</DropdownMenu.CheckboxItem>
	<DropdownMenu.CheckboxItem
		checked={themeState.theme === "system"}
		onCheckedChange={(checked) => checked && themeState.setTheme("system")}
	>
		System
	</DropdownMenu.CheckboxItem>
</Selector>
