<script lang="ts">
import { HugeiconsIcon } from "@acepe/ui";
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
	class="acepe-toaster"
	style="--normal-bg: var(--card); --normal-text: var(--color-card-foreground);"
	toastOptions={{
		classes: {
			toast: "acepe-toast",
			title: "acepe-toast-title",
			description: "acepe-toast-description",
			icon: "acepe-toast-icon",
			closeButton: "acepe-toast-close",
		},
	}}
	{...restProps}
>
	{#snippet loadingIcon()}
		<Spinner size={16} />
	{/snippet}
	{#snippet closeIcon()}
		<HugeiconsIcon name="close" class="size-3" />
	{/snippet}
</Sonner>

<style>
	/* Tauri top-center: cancel Sonner's translateX(-50%) so toasts stay centered in the window. */
	:global([data-sonner-toaster].acepe-toaster) {
		left: 0 !important;
		right: 0 !important;
		width: 100% !important;
		transform: none !important;
		display: flex !important;
		flex-direction: column !important;
		align-items: center !important;
		pointer-events: none !important;
	}

	:global([data-sonner-toaster].acepe-toaster [data-sonner-toast].acepe-toast) {
		pointer-events: auto;
		border: 1px solid color-mix(in srgb, var(--border) 70%, transparent) !important;
		background: var(--card) !important;
		backdrop-filter: blur(12px);
		min-height: 38px !important;
		width: fit-content !important;
		max-width: min(520px, calc(100vw - 32px)) !important;
		padding: 0 38px 0 16px !important;
		border-radius: var(--radius-lg) !important;
		box-shadow: 0 14px 42px rgb(0 0 0 / 0.24) !important;
		color: var(--card-foreground);
	}

	:global([data-sonner-toaster].acepe-toaster [data-sonner-toast] [data-content]) {
		min-width: 0;
	}

	:global([data-sonner-toaster].acepe-toaster [data-sonner-toast] .acepe-toast-title) {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 13px;
		line-height: 18px;
		font-weight: 500;
	}

	:global([data-sonner-toaster].acepe-toaster [data-sonner-toast] .acepe-toast-description),
	:global([data-sonner-toaster].acepe-toaster [data-sonner-toast] .acepe-toast-icon) {
		display: none !important;
	}

	/* Match agent header close geometry (size-5, rounded-md) with destructive colors. */
	:global([data-sonner-toaster].acepe-toaster [data-sonner-toast] .acepe-toast-close) {
		right: 8px !important;
		left: auto !important;
		top: calc(50% - 10px) !important;
		transform: none !important;
		display: inline-flex !important;
		align-items: center !important;
		justify-content: center !important;
		width: 20px !important;
		height: 20px !important;
		min-width: 20px !important;
		min-height: 20px !important;
		padding: 0 !important;
		margin: 0 !important;
		opacity: 1 !important;
		border: none !important;
		border-radius: var(--radius-md) !important;
		background: transparent !important;
		color: color-mix(in srgb, var(--destructive) 72%, transparent) !important;
		box-shadow: none !important;
		transition-property: color, background-color;
		transition-duration: 75ms;
		transition-timing-function: ease-out;
	}

	:global([data-sonner-toaster].acepe-toaster [data-sonner-toast] .acepe-toast-close:hover) {
		color: var(--destructive) !important;
		background: color-mix(in srgb, var(--destructive) 12%, transparent) !important;
	}
</style>
