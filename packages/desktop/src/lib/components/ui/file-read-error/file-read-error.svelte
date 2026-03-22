<script lang="ts">
import XCircle from "phosphor-svelte/lib/XCircle";
import { Card } from "$lib/components/ui/card/index.js";
import * as m from "$lib/paraglide/messages.js";

interface Props {
	/** Error message from the file read operation (e.g. "No such file or directory") */
	message: string;
	/** Optional file path to display */
	path?: string | null;
	/** Whether to center the content (e.g. in a preview panel) */
	centered?: boolean;
}

let { message, path = null, centered = false }: Props = $props();
</script>

<Card
	class="file-read-error flex flex-col gap-1.5 px-3 py-2.5 {centered
		? 'items-center justify-center text-center min-h-[4rem]'
		: ''}"
	role="alert"
>
	<div class="flex items-center gap-2">
		<XCircle weight="fill" class="size-3.5 shrink-0 text-destructive" />
		<span class="text-[13px] font-medium text-destructive">{m.file_panel_read_error_title()}</span>
	</div>
	<p class="text-[12px] text-muted-foreground leading-snug {centered ? 'text-center' : ''}">
		{message}
	</p>
	{#if path}
		<p
			class="font-mono text-[11px] text-muted-foreground/80 truncate max-w-full tabular-nums {centered
				? 'text-center'
				: ''}"
			title={path}
		>
			{path}
		</p>
	{/if}
</Card>
