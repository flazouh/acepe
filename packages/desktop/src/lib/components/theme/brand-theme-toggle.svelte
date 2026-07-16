<script lang="ts">
import { HugeiconsIcon, Selector } from "@acepe/ui";
import * as DropdownMenu from "@acepe/ui/dropdown-menu";

import { useTheme } from "./context.svelte.js";

const themeState = useTheme();
</script>

<!--
	Theme toggle tuned for the brand surface (onboarding + update overlay): the
	trigger icon reflects the selected theme and is tinted cream so it stays
	legible on the brand shader regardless of the active theme.
-->
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
			<HugeiconsIcon name="sun" style="color: #F8F5EE" />
		{:else if themeState.theme === "dark"}
			<HugeiconsIcon name="moon" style="color: #F8F5EE" />
		{:else}
			<HugeiconsIcon name="laptop" style="color: #F8F5EE" data-testid="brand-theme-system-icon" />
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
