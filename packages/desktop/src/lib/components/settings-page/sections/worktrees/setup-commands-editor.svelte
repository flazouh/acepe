<script lang="ts">
	import { ScriptEditor } from "@acepe/ui/script-editor";
	import { onMount } from "svelte";
	import { Spinner } from "$lib/components/ui/spinner/index.js";
	import { bashHighlighter } from "$lib/acp/utils/bash-highlighter.svelte.js";
	import { tauriClient } from "$lib/utils/tauri-client.js";

	interface Props {
		projectPath: string;
	}

	let { projectPath }: Props = $props();

	type Status = "loading" | "ready" | "error";

	let status = $state<Status>("loading");
	let script = $state("");
	let remoteScript = $state("");
	let isSaving = $state(false);
	let saveTimer: ReturnType<typeof setTimeout> | null = null;

	function commandsToScript(commands: readonly string[]): string {
		return commands.join("\n");
	}

	function scriptToCommands(value: string): string[] {
		return value.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
	}

	async function load() {
		status = "loading";
		await tauriClient.git.loadWorktreeConfig(projectPath).match(
			(config) => {
				const next = commandsToScript(config?.setupCommands ?? []);
				script = next;
				remoteScript = next;
				status = "ready";
			},
			() => {
				status = "error";
			}
		);
	}

	onMount(() => {
		void load();
		return () => {
			if (saveTimer) clearTimeout(saveTimer);
		};
	});

	async function persist(nextScript: string) {
		if (nextScript === remoteScript) return;
		isSaving = true;
		const nextCommands = scriptToCommands(nextScript);
		await tauriClient.git.saveWorktreeConfig(projectPath, nextCommands).match(
			() => {
				remoteScript = commandsToScript(nextCommands);
				isSaving = false;
			},
			() => {
				isSaving = false;
			}
		);
	}

	function handleChange(next: string) {
		script = next;
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(() => {
			void persist(script);
		}, 500);
	}

	function handleBlur(next: string) {
		if (saveTimer) {
			clearTimeout(saveTimer);
			saveTimer = null;
		}
		void persist(next);
	}

	function shikiHighlight(code: string): string | null {
		if (!bashHighlighter.ready) return null;
		return bashHighlighter.highlight(code);
	}
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
	<div class="flex flex-col gap-1">
		<ScriptEditor
			value={script}
			onChange={handleChange}
			onBlur={handleBlur}
			highlight={shikiHighlight}
			minLines={3}
			maxLines={12}
			placeholder={"bun install\nbun run check"}
			ariaLabel="Worktree setup script"
			class={isSaving ? "opacity-70" : ""}
		/>
		<div class="px-1 text-[10px] text-muted-foreground/50">
			{isSaving ? "Saving…" : "Runs after creating a worktree. Each line is one command."}
		</div>
	</div>
{/if}
