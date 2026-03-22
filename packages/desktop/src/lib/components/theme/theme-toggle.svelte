<script lang="ts">
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import { EmbeddedIconButton } from "@acepe/ui/panel-header";
import Moon from "phosphor-svelte/lib/Moon";
import Sun from "phosphor-svelte/lib/Sun";

import { useTheme } from "./context.svelte.js";

let { class: className = "" } = $props();
const themeState = useTheme();
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<EmbeddedIconButton
				title="Toggle theme"
				ariaLabel="Toggle theme"
				class={className}
				{...props}
			>
				{#if themeState.effectiveTheme === "light"}
					<Sun weight="fill" class="size-4" />
				{:else}
					<Moon weight="fill" class="size-4" />
				{/if}
			</EmbeddedIconButton>
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="end">
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
	</DropdownMenu.Content>
</DropdownMenu.Root>
