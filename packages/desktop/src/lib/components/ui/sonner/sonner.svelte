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
	position="top-center"
	closeButton
	offset="18px"
	class="toaster group"
	style="--normal-bg: color-mix(in srgb, var(--popover) 92%, var(--foreground) 8%); --normal-text: var(--color-popover-foreground);"
	toastOptions={{
		classes: {
			toast:
				"!bg-[color-mix(in_srgb,var(--popover)_92%,var(--foreground)_8%)] text-popover-foreground shadow-lg rounded-lg !border-none backdrop-blur-md",
			title: "truncate",
			description: "hidden",
			icon: "hidden",
			closeButton:
				"!end-2 !start-auto !top-[calc(50%-14px)] !translate-x-0 !translate-y-0 !opacity-100",
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
