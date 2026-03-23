<script lang="ts">
import { playSound } from "$lib/acp/utils/sound.js";
import { cn } from "$lib/utils.js";

import { type ButtonProps, buttonVariants } from "./variants.js";

let {
	class: className,
	variant = "default",
	size = "default",
	ref = $bindable(null),
	href,
	type = "button",
	disabled,
	children,
	soundEffect,
	onclick,
	...restProps
}: ButtonProps = $props();

function handleClick(e: MouseEvent) {
	if (soundEffect) {
		playSound(soundEffect);
	}
	if (onclick) {
		(onclick as (e: MouseEvent) => void)(e);
	}
}
</script>

{#if href}
	<a
		bind:this={ref}
		data-slot="button"
		class={cn(buttonVariants({ variant, size }), className)}
		href={disabled ? undefined : href}
		aria-disabled={disabled}
		role={disabled ? "link" : null}
		tabindex={disabled ? -1 : null}
		{...restProps}
	>
		{@render children?.()}
	</a>
{:else}
	<button
		bind:this={ref}
		data-slot="button"
		class={cn(buttonVariants({ variant, size }), className)}
		{type}
		{disabled}
		onclick={handleClick}
		{...restProps}
	>
		{@render children?.()}
	</button>
{/if}
