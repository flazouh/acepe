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
	const iconName = $derived(
		status === "added" || status === "untracked" ? "add" : status === "deleted" ? "trash" : "edit",
	);
</script>

<span
	class={cn("relative inline-flex size-3.5 shrink-0 items-center justify-center", className)}
	data-status={status}
	data-testid={testId}
	aria-hidden="true"
>
	<RoundedIcon name={iconName} class="size-3.5" />
</span>
