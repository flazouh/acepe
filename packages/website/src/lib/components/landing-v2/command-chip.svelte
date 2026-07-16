<script lang="ts">
import { HugeiconsIcon } from "@acepe/ui";

interface Props {
	/** The shell command shown after the `$` prompt, e.g. `brew install --cask acepe`. */
	command: string;
	class?: string;
}

let { command, class: className = "" }: Props = $props();

let copied = $state(false);
let resetTimer: ReturnType<typeof setTimeout> | undefined;

function copy(): void {
	void navigator.clipboard.writeText(command).then(() => {
		copied = true;
		clearTimeout(resetTimer);
		resetTimer = setTimeout(() => {
			copied = false;
		}, 1600);
	});
}
</script>

<button
	type="button"
	onclick={copy}
	class="group inline-flex h-9 items-center gap-3 rounded-[2px] bg-[#f8f5ee]/[0.05] pr-2.5 pl-3.5 font-mono text-[13px] text-[#f8f5ee]/75 transition-colors hover:bg-[#f8f5ee]/[0.1] hover:text-[#f8f5ee] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f8f5ee]/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[#121212] {className}"
	aria-label="Copy command: {command}"
	title="Copy"
>
	<span class="select-none text-[#f8f5ee]/35">$</span>
	<span class="whitespace-nowrap">{command}</span>
	<span class="flex h-5 w-5 shrink-0 items-center justify-center text-[#f8f5ee]/40 transition-colors group-hover:text-[#f8f5ee]/80">
		{#if copied}
			<HugeiconsIcon name="check" class="h-3.5 w-3.5 text-[#7fd88f]" />
		{:else}
			<HugeiconsIcon name="copy" class="h-3.5 w-3.5" />
		{/if}
	</span>
</button>
