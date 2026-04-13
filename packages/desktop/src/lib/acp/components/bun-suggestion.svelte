<script lang="ts">
import { IconChevronRight } from "@tabler/icons-svelte";
import * as m from "$lib/messages.js";

interface Props {
	onclick: () => void;
}

let { onclick }: Props = $props();
</script>

<button
	type="button"
	{onclick}
	class="flex items-center gap-2.5 w-full px-3 py-2.5 text-left
		bg-amber-500/10 hover:bg-amber-500/15 border border-amber-500/20
		rounded-lg transition-colors group"
>
	<img src="/svgs/others/bun.svg" alt={m.alt_bun_logo()} class="size-5 shrink-0" />
	<div class="flex-1 min-w-0">
		<p class="text-xs font-medium text-amber-600 dark:text-amber-400 truncate">
			{m.bun_suggestion_title()}
		</p>
		<p class="text-[10px] text-amber-600/70 dark:text-amber-400/70 truncate">
			{m.bun_suggestion_description()}
		</p>
	</div>
	<IconChevronRight
		class="size-4 text-amber-500/50 group-hover:text-amber-500 transition-colors shrink-0"
	/>
</button>
