<script lang="ts">
import { Selector } from "@acepe/ui";
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import { Moon } from "@acepe/ui/icons";
import { Sun } from "@acepe/ui/icons";

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
			<Sun weight="fill" class="size-4" />
		{:else}
			<Moon weight="fill" class="size-4" />
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
