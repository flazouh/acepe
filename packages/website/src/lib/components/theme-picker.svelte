<script lang="ts">
import { onMount } from "svelte";
import { get } from "svelte/store";
import { HugeiconsIcon, Selector } from "@acepe/ui";
import * as DropdownMenu from "@acepe/ui/dropdown-menu";

import {
	setWebsiteThemePreference,
	websiteThemePreferenceStore,
	type WebsiteThemePreference,
} from "$lib/theme/theme.js";

interface Props {
	class?: string;
}

let { class: className = "" }: Props = $props();

const preference = $derived($websiteThemePreferenceStore);

onMount(() => {
	const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
	const handleChange = () => {
		if (get(websiteThemePreferenceStore) === "system") {
			setWebsiteThemePreference("system", { persist: false });
		}
	};
	mediaQuery.addEventListener("change", handleChange);
	return () => mediaQuery.removeEventListener("change", handleChange);
});

function selectPreference(next: WebsiteThemePreference): void {
	setWebsiteThemePreference(next);
}
</script>

<Selector
	align="end"
	triggerSize="icon"
	showChevron={false}
	tooltipLabel="Theme"
	triggerAriaLabel="Theme"
	class={className}
	variant="ghost"
>
	{#snippet renderButton()}
		{#if preference === "light"}
			<HugeiconsIcon name="sun" class="h-4 w-4" />
		{:else if preference === "dark"}
			<HugeiconsIcon name="moon" class="h-4 w-4" />
		{:else}
			<HugeiconsIcon name="laptop" class="h-4 w-4" data-testid="website-theme-system-icon" />
		{/if}
	{/snippet}

	<DropdownMenu.CheckboxItem
		checked={preference === "light"}
		onCheckedChange={(checked) => checked && selectPreference("light")}
	>
		Light
	</DropdownMenu.CheckboxItem>
	<DropdownMenu.CheckboxItem
		checked={preference === "dark"}
		onCheckedChange={(checked) => checked && selectPreference("dark")}
	>
		Dark
	</DropdownMenu.CheckboxItem>
	<DropdownMenu.CheckboxItem
		checked={preference === "system"}
		onCheckedChange={(checked) => checked && selectPreference("system")}
	>
		System
	</DropdownMenu.CheckboxItem>
</Selector>
