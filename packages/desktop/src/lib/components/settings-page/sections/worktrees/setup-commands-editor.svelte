<script lang="ts">
import { X } from "phosphor-svelte";
import { untrack } from "svelte";
import { Kbd } from "$lib/components/ui/kbd/index.js";
import * as m from "$lib/paraglide/messages.js";
import { tauriClient } from "$lib/utils/tauri-client.js";

interface Props {
	projectPath: string;
}

let { projectPath }: Props = $props();

let commands = $state<string[]>([]);
let newCommand = $state("");
let inputEl = $state<HTMLInputElement | null>(null);

$effect(() => {
	const path = projectPath;
	let cancelled = false;
	void tauriClient.git.loadWorktreeConfig(path).match(
		(config) => {
			if (cancelled) return;
			untrack(() => {
				commands = [...(config?.setupCommands ?? [])];
			});
		},
		() => {}
	);
	return () => {
		cancelled = true;
	};
});

function save() {
	void tauriClient.git.saveWorktreeConfig(projectPath, $state.snapshot(commands));
}

function addCommand() {
	const trimmed = newCommand.trim();
	if (!trimmed) return;
	if (commands.includes(trimmed)) {
		newCommand = "";
		return;
	}
	commands.push(trimmed);
	newCommand = "";
	save();
	inputEl?.focus();
}

function removeCommand(index: number) {
	commands.splice(index, 1);
	save();
}

function handleKeydown(event: KeyboardEvent) {
	if (event.key === "Enter") {
		event.preventDefault();
		addCommand();
	} else if (event.key === "Escape") {
		newCommand = "";
		inputEl?.blur();
	}
}
</script>

<div class="overflow-hidden rounded-sm border border-border bg-muted/30">
	{#if commands.length > 0}
		<ul class="list-none m-0 p-0" role="list">
			{#each commands as command, index (command + index)}
				<li
					class="group flex items-center px-3 py-1.5 border-b border-border/30 last:border-b-0"
				>
					<span class="mr-1.5 select-none font-mono text-[12px] text-muted-foreground/40"
						>$</span
					>
					<span class="min-w-0 flex-1 truncate font-mono text-[12px]">{command}</span>
					<button
						type="button"
						class="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 p-0.5 rounded-sm text-muted-foreground/40 hover:text-foreground"
						aria-label="Remove command: {command}"
						onclick={() => removeCommand(index)}
					>
						<X class="h-3.5 w-3.5" />
					</button>
				</li>
			{/each}
		</ul>
	{/if}

	<div class="h-8 border-t border-border/50 flex items-center px-3 gap-1.5">
		<input
			bind:this={inputEl}
			type="text"
			bind:value={newCommand}
			placeholder={m.settings_worktrees_add_placeholder()}
			class="flex-1 bg-transparent font-mono text-[12px] outline-none placeholder:text-[12px] placeholder:text-muted-foreground/30"
			onkeydown={handleKeydown}
		/>
		{#if newCommand.trim()}
			<Kbd class="shrink-0">↵</Kbd>
		{/if}
	</div>
</div>

<p class="mt-1.5 text-[11px] text-muted-foreground/30">
	{m.settings_worktrees_config_hint()}
</p>
