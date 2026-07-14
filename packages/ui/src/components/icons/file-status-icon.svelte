<script lang="ts">
import { cn } from "../../lib/utils.js";
import HugeiconsIcon from "./hugeicons-icon.svelte";
	import { getFileStatusIconModel } from "./file-status-icon-model.js";
	import type { FileStatusIconKind } from "./file-status-icon-types.js";

	interface Props {
		status: FileStatusIconKind;
		class?: string;
		"data-testid"?: string;
	}

	let { status, class: className, "data-testid": testId }: Props = $props();
	const icon = $derived(getFileStatusIconModel(status));
</script>

<span
	class={cn("relative inline-flex size-3.5 shrink-0 items-center justify-center", className)}
	data-status={status}
	data-testid={testId}
	aria-hidden="true"
>
	<HugeiconsIcon name={icon.name} class="size-3.5" />
</span>
