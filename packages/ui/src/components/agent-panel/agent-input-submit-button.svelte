<script lang="ts">
import type { AgentInputSubmitIntent } from "./agent-input-editor.svelte";

interface Props {
	intent?: AgentInputSubmitIntent;
	disabled?: boolean;
	ariaLabel?: string;
	onSubmit?: () => void;
}

let { intent = "send", disabled = false, ariaLabel = "Send message", onSubmit }: Props = $props();

const showStop = $derived(intent === "stop" || intent === "steer");
</script>

<button
	data-slot="button"
	data-variant="default"
	data-size="icon"
	type="button"
	onclick={onSubmit}
	{disabled}
	aria-label={ariaLabel}
	class="inline-flex h-8 w-8 cursor-pointer shrink-0 items-center justify-center gap-0 whitespace-nowrap rounded-lg bg-foreground p-0 text-sm font-medium text-background transition-all outline-none hover:bg-foreground/85 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0"
>
	{#if showStop}
		<svg
			class="h-4 w-4 shrink-0"
			aria-hidden="true"
			viewBox="0 0 20 20"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path
				d="M4.5 5.75C4.5 5.05964 5.05964 4.5 5.75 4.5H14.25C14.9404 4.5 15.5 5.05964 15.5 5.75V14.25C15.5 14.9404 14.9404 15.5 14.25 15.5H5.75C5.05964 15.5 4.5 14.9404 4.5 14.25V5.75Z"
				fill="currentColor"
			/>
		</svg>
	{:else}
		<svg
			class="h-4 w-4 shrink-0"
			aria-hidden="true"
			viewBox="0 0 20 20"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path
				d="M9.33467 16.6663V4.93978L4.6374 9.63704L4.1667 9.16634L3.69599 8.69661L9.52998 2.86263L9.63447 2.77767C9.8925 2.60753 10.2433 2.63564 10.4704 2.86263L16.3034 8.69661L16.3884 8.80111C16.5588 9.05922 16.5306 9.40982 16.3034 9.63704C16.0762 9.86414 15.7255 9.89242 15.4675 9.722L15.363 9.63704L10.6647 4.9388V16.6663C10.6647 17.0336 10.367 17.3314 9.99971 17.3314C9.63259 17.3312 9.33467 17.0335 9.33467 16.6663ZM4.6374 9.63704C4.3777 9.89674 3.95569 9.89674 3.69599 9.63704C3.43657 9.37744 3.43668 8.95628 3.69599 8.69661L4.6374 9.63704Z"
				fill="currentColor"
			/>
		</svg>
	{/if}
	<span class="sr-only">{ariaLabel}</span>
</button>
