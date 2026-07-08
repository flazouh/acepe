<script lang="ts">
import { RoundedIcon, Selector } from "@acepe/ui";
import * as DropdownMenu from "@acepe/ui/dropdown-menu";

import { useTheme } from "./context.svelte.js";

let { class: className = "" } = $props();
const themeState = useTheme();
</script>

<Selector
	align="end"
	triggerSize="icon"
	showChevron={false}
	tooltipLabel="Toggle theme"
	triggerAriaLabel="Toggle theme"
	class={className}
	variant="ghost"
>
	{#snippet renderButton()}
		{#if themeState.effectiveTheme === "light"}
			<RoundedIcon name="sun" />
		{:else}
			<RoundedIcon name="moon" />
		{/if}
	{/snippet}

	<DropdownMenu.CheckboxItem
		checked={themeState.theme === "light"}
		onCheckedChange={(v) => v && themeState.setTheme("light")}
	>
		Light
	</DropdownMenu.CheckboxItem>
	<DropdownMenu.CheckboxItem
		checked={themeState.theme === "dark"}
		onCheckedChange={(v) => v && themeState.setTheme("dark")}
	>
		Dark
	</DropdownMenu.CheckboxItem>
	<DropdownMenu.CheckboxItem
		checked={themeState.theme === "system"}
		onCheckedChange={(v) => v && themeState.setTheme("system")}
	>
		System
	</DropdownMenu.CheckboxItem>
</Selector>
