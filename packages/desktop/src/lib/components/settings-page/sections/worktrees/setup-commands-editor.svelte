<script lang="ts">
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Spinner } from "$lib/components/ui/spinner/index.js";
	import { Textarea } from "$lib/components/ui/textarea/index.js";
	import { tauriClient } from "$lib/utils/tauri-client.js";

	interface Props {
		projectPath: string;
	}

	let { projectPath }: Props = $props();

	type Status = "loading" | "ready" | "error";

	let status = $state<Status>("loading");
	let setupScript = $state("");
	let isSaving = $state(false);

	async function load() {
		status = "loading";
		await tauriClient.git.loadWorktreeConfig(projectPath).match(
			(config) => {
				setupScript = config ? config.setupScript : "";
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

	async function persistScript() {
		isSaving = true;
		await tauriClient.git.saveWorktreeConfig(projectPath, setupScript).match(
			() => {
				isSaving = false;
			},
			(error) => {
				isSaving = false;
				toast.error(`Failed to save setup script: ${error.message}`);
			}
		);
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
	<div class="flex flex-col gap-2">
		<Textarea
			rows={6}
			class="min-h-[120px] font-mono text-[12px] placeholder:text-muted-foreground/50"
			bind:value={setupScript}
			placeholder={"Runs after Acepe creates a worktree for this project."}
			disabled={isSaving}
		/>
		<div class="flex items-center justify-between gap-3">
			<div class="text-[11px] text-muted-foreground/60">
				Blank value clears the setup script.
			</div>
			<Button
				size="sm"
				variant="secondary"
				disabled={isSaving}
				onclick={() => {
					void persistScript();
				}}
			>
				{isSaving ? "Saving..." : "Save setup script"}
			</Button>
		</div>
	</div>
{/if}
