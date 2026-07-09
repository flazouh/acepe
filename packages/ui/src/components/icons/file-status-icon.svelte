<script lang="ts">
	import { cn } from "../../lib/utils.js";
	import RoundedIcon from "./rounded-icon.svelte";
	import type { FileStatusIconKind } from "./file-status-icon-types.js";

	interface Props {
		status: FileStatusIconKind;
		class?: string;
		"data-testid"?: string;
	}

	let { status, class: className, "data-testid": testId }: Props = $props();
</script>

<span
	class={cn("relative inline-flex size-3.5 shrink-0 items-center justify-center", className)}
	data-status={status}
	data-testid={testId}
	aria-hidden="true"
>
	<RoundedIcon name="file-text" class="size-3.5" />
	<span class="file-status-badge">
		{#if status === "added" || status === "untracked"}
			<span class="file-status-line file-status-line-horizontal"></span>
			<span class="file-status-line file-status-line-vertical"></span>
		{:else if status === "deleted"}
			<span class="file-status-line file-status-line-slash"></span>
			<span class="file-status-line file-status-line-backslash"></span>
		{:else}
			<span class="file-status-line file-status-line-horizontal"></span>
		{/if}
	</span>
</span>

<style>
	.file-status-badge {
		position: absolute;
		right: -1px;
		bottom: -1px;
		width: 7px;
		height: 7px;
		border: 1.2px solid currentColor;
		border-radius: 999px;
		background: var(--background);
	}

	.file-status-line {
		position: absolute;
		left: 50%;
		top: 50%;
		width: 4px;
		height: 1.2px;
		border-radius: 999px;
		background: currentColor;
		transform-origin: center;
	}

	.file-status-line-horizontal {
		transform: translate(-50%, -50%);
	}

	.file-status-line-vertical {
		transform: translate(-50%, -50%) rotate(90deg);
	}

	.file-status-line-slash {
		transform: translate(-50%, -50%) rotate(45deg);
	}

	.file-status-line-backslash {
		transform: translate(-50%, -50%) rotate(-45deg);
	}
</style>
