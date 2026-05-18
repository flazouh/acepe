<script lang="ts">
import CircleCheckIcon from "@lucide/svelte/icons/circle-check";
import InfoIcon from "@lucide/svelte/icons/info";
import OctagonXIcon from "@lucide/svelte/icons/octagon-x";
import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
import { mode } from "mode-watcher";
import { Toaster as Sonner, toast, type ToasterProps as SonnerProps } from "svelte-sonner";
import Spinner from "$lib/components/ui/spinner/spinner.svelte";
import { registerToastBridge } from "./toast-bridge.js";

let { ...restProps }: SonnerProps = $props();

registerToastBridge({
	success: toast.success,
	error: toast.error,
	info: toast.info,
	warning: toast.warning,
});
</script>

<Sonner
	theme={mode.current}
	class="toaster group"
	style="--normal-bg: color-mix(in srgb, var(--popover) 80%, transparent); --normal-text: var(--color-popover-foreground);"
	toastOptions={{
		classes: {
			toast:
				"!bg-[color-mix(in_srgb,var(--popover)_80%,transparent)] text-popover-foreground shadow-md rounded-lg !border-none backdrop-blur-md",
		},
	}}
	{...restProps}
	>{#snippet loadingIcon()}
		<Spinner size={16} />
	{/snippet}
	{#snippet successIcon()}
		<CircleCheckIcon class="size-4" />
	{/snippet}
	{#snippet errorIcon()}
		<OctagonXIcon class="size-4" />
	{/snippet}
	{#snippet infoIcon()}
		<InfoIcon class="size-4" />
	{/snippet}
	{#snippet warningIcon()}
		<TriangleAlertIcon class="size-4" />
	{/snippet}
</Sonner>
