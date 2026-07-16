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
	class="group inline-flex h-9 items-center gap-3 rounded-[2px] bg-foreground/[0.05] pr-2.5 pl-3.5 font-mono text-[13px] text-foreground/75 transition-colors hover:bg-foreground/[0.1] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background {className}"
	aria-label="Copy command: {command}"
	title="Copy"
>
	<span class="select-none text-foreground/35">$</span>
	<span class="whitespace-nowrap">{command}</span>
	<span class="flex h-5 w-5 shrink-0 items-center justify-center text-foreground/40 transition-colors group-hover:text-foreground/80">
		{#if copied}
			<HugeiconsIcon name="check" class="h-3.5 w-3.5 text-success" />
		{:else}
			<HugeiconsIcon name="copy" class="h-3.5 w-3.5" />
		{/if}
	</span>
</button>
