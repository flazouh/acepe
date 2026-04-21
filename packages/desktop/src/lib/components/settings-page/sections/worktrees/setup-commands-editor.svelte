<script lang="ts">
	import { onMount } from "svelte";
	import { X } from "phosphor-svelte";
	import { Kbd } from "$lib/components/ui/kbd/index.js";
	import { Spinner } from "$lib/components/ui/spinner/index.js";
	import { tauriClient } from "$lib/utils/tauri-client.js";

	interface Props {
		projectPath: string;
	}

	let { projectPath }: Props = $props();

	type Status = "loading" | "ready" | "error";

	let status = $state<Status>("loading");
	let commands = $state<string[]>([]);
	let newCommand = $state("");
	let inputEl = $state<HTMLInputElement | null>(null);
	let isSaving = $state(false);

	async function load() {
		status = "loading";
		await tauriClient.git.loadWorktreeConfig(projectPath).match(
			(config) => {
				commands = [...(config?.setupCommands ?? [])];
				status = "ready";
			},
			() => {
				status = "error";
			}
		);
	}

	onMount(() => {
		void load();
	});

	async function persistCommands(nextCommands: string[]) {
		isSaving = true;
		await tauriClient.git.saveWorktreeConfig(projectPath, nextCommands).match(
			() => {
				isSaving = false;
			},
			() => {
				isSaving = false;
			}
		);
	}

	async function addCommand() {
		const trimmed = newCommand.trim();
		if (!trimmed) return;
		if (commands.includes(trimmed)) {
			newCommand = "";
			return;
		}
		const next = [...commands, trimmed];
		commands = next;
		newCommand = "";
		await persistCommands(next);
		inputEl?.focus();
	}

	async function removeCommand(index: number) {
		const next = commands.filter((_, i) => i !== index);
		commands = next;
		await persistCommands(next);
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === "Enter") {
			event.preventDefault();
			void addCommand();
		} else if (event.key === "Escape") {
			newCommand = "";
			inputEl?.blur();
		}
	}

	let hasCommands = $derived(commands.length > 0);
</script>

{#if status === "loading"}
	<div class="flex items-center justify-center py-3">
		<Spinner class="h-3 w-3 text-muted-foreground/50" />
	</div>
{:else if status === "error"}
	<button
		type="button"
		class="w-full py-2 text-center text-[0.6875rem] text-muted-foreground hover:text-foreground transition-colors"
		onclick={() => void load()}
	>
		{"Could not load setup scripts"} · {"Retry"}
	</button>
{:else}
	<div class="overflow-hidden rounded-lg bg-muted/20 shadow-sm">
		{#each commands as command, index (command + index)}
			<div
				class="group flex items-center gap-1.5 px-3 h-8 {index > 0 ? 'border-t border-border/40' : ''}"
				class:opacity-50={isSaving}
			>
				<span class="min-w-0 flex-1 truncate text-[12px] text-foreground">{command}</span>
				<button
					type="button"
					class="shrink-0 size-5 flex items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:text-foreground hover:bg-accent group-hover:opacity-100 disabled:pointer-events-none"
					disabled={isSaving}
					aria-label="Remove command: {command}"
					onclick={() => void removeCommand(index)}
				>
					<X size={10} />
				</button>
			</div>
		{/each}

		<div
			class="flex items-center gap-1.5 px-3 h-8 {hasCommands ? 'border-t border-border/40' : ''}"
			class:opacity-50={isSaving}
		>
			<input
				bind:this={inputEl}
				type="text"
				bind:value={newCommand}
				placeholder={hasCommands ? "add a command..." : "Commands run after creating a worktree (e.g., install dependencies)"}
				disabled={isSaving}
				class="min-w-0 flex-1 bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
				onkeydown={handleKeydown}
			/>
			{#if newCommand.trim()}
				<Kbd class="shrink-0">enter</Kbd>
			{/if}
		</div>
	</div>
{/if}
