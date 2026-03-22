<script lang="ts">
import IconCheck from "@tabler/icons-svelte/icons/check";
import IconEye from "@tabler/icons-svelte/icons/eye";
import IconEyeOff from "@tabler/icons-svelte/icons/eye-off";
import IconX from "@tabler/icons-svelte/icons/x";
import { Button } from "$lib/components/ui/button/index.js";
import { Input } from "$lib/components/ui/input/index.js";
import * as m from "$lib/paraglide/messages.js";

let {
	value = $bindable(""),
	onSave,
	onClear,
	isLoading = false,
}: {
	value?: string;
	onSave: (value: string) => void;
	onClear: () => void;
	isLoading?: boolean;
} = $props();

let showPassword = $state(false);
let inputValue = $state(value || "");
let hasChanges = $derived(inputValue !== value);

function handleSave() {
	onSave(inputValue);
}

function handleClear() {
	inputValue = "";
	onClear();
}
</script>

<div class="space-y-2">
	<div class="relative">
		<Input
			type={showPassword ? "text" : "password"}
			bind:value={inputValue}
			placeholder={m.api_key_placeholder()}
			class="pr-20"
			disabled={isLoading}
		/>
		<Button
			type="button"
			variant="ghost"
			size="icon"
			class="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6"
			onclick={() => (showPassword = !showPassword)}
			disabled={isLoading}
		>
			{#if showPassword}
				<IconEyeOff class="h-4 w-4" />
			{:else}
				<IconEye class="h-4 w-4" />
			{/if}
		</Button>
	</div>
	<div class="flex items-center gap-2">
		<Button
			variant="default"
			size="sm"
			onclick={handleSave}
			disabled={!hasChanges || isLoading || !inputValue.trim()}
		>
			<IconCheck class="h-4 w-4 mr-2" />
			{m.common_save()}
		</Button>
		{#if value}
			<Button variant="outline" size="sm" onclick={handleClear} disabled={isLoading}>
				<IconX class="h-4 w-4 mr-2" />
				{m.common_clear()}
			</Button>
		{/if}
	</div>
</div>
