<script lang="ts">
import { onMount } from "svelte";
import { toast } from "svelte-sonner";
import { ScriptEditor } from "@acepe/ui/script-editor";
import type { ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";
import type { ProjectAcepeConfig } from "$lib/utils/tauri-client/types.js";
import { bashHighlighter } from "$lib/acp/utils/bash-highlighter.svelte.js";
import { Button } from "$lib/components/ui/button/index.js";
import { Spinner } from "$lib/components/ui/spinner/index.js";
import { Switch } from "$lib/components/ui/switch/index.js";
import { tauriClient } from "$lib/utils/tauri-client.js";
import SettingRow from "../../setting-row.svelte";
import SettingsSection from "../../settings-section.svelte";

interface Props {
	projectManager: ProjectManager;
	projectPath: string;
	projectName: string;
}

type Status = "loading" | "ready" | "error";

let { projectManager, projectPath, projectName }: Props = $props();

let status = $state<Status>("loading");
let hideExternalCliSessions = $state(false);
let setupScriptDraft = $state("");
let runScriptDraft = $state("");
let isSavingVisibility = $state(false);
let isSavingSetupScript = $state(false);
let isSavingRunScript = $state(false);

function currentConfig(showExternalCliSessions: boolean): ProjectAcepeConfig {
	return {
		setupScript: setupScriptDraft,
		runScript: runScriptDraft,
		showExternalCliSessions,
	};
}

function applyLoadedSettings(settings: ProjectAcepeConfig) {
	hideExternalCliSessions = !settings.showExternalCliSessions;
	setupScriptDraft = settings.setupScript;
	runScriptDraft = settings.runScript;
}

async function loadSettings() {
	status = "loading";
	await tauriClient.projects.getProjectAcepeConfig(projectPath).match(
		(settings) => {
			applyLoadedSettings(settings);
			status = "ready";
		},
		(error) => {
			status = "error";
			toast.error(`Failed to load project settings: ${error.message}`);
		}
	);
}

onMount(() => {
	void loadSettings();
});

async function reloadVisibilityOrFallback(previousValue: boolean) {
	await tauriClient.projects.getProjectAcepeConfig(projectPath).match(
		(settings) => {
			applyLoadedSettings(settings);
		},
		() => {
			hideExternalCliSessions = previousValue;
		}
	);
}

async function saveVisibility(nextValue: boolean) {
	const previousValue = hideExternalCliSessions;
	hideExternalCliSessions = nextValue;
	isSavingVisibility = true;

	const result = await projectManager.updateProjectShowExternalCliSessions(projectPath, !nextValue);
	if (result.isErr()) {
		toast.error(`Failed to save project visibility: ${result.error.message}`);
		await reloadVisibilityOrFallback(previousValue);
	}

	isSavingVisibility = false;
}

async function saveScript(kind: "setup_script" | "run_script") {
	const isSetup = kind === "setup_script";
	if (isSetup) {
		isSavingSetupScript = true;
	} else {
		isSavingRunScript = true;
	}

	const nextConfig = currentConfig(!hideExternalCliSessions);
	await tauriClient.projects.saveProjectAcepeConfig(projectPath, nextConfig).match(
		(saved) => {
			applyLoadedSettings(saved);
		},
		(error) => {
			toast.error(`Failed to save project script: ${error.message}`);
		}
	);

	if (isSetup) {
		isSavingSetupScript = false;
	} else {
		isSavingRunScript = false;
	}
}

function shikiHighlight(code: string): string | null {
	if (!bashHighlighter.ready) return null;
	return bashHighlighter.highlight(code);
}
</script>

<SettingsSection
	title="Projects"
	description={`Manage project-scoped settings for ${projectName}.`}
>
	{#if status === "loading"}
		<div class="flex items-center justify-center py-10">
			<Spinner class="size-4 text-muted-foreground/60" />
		</div>
	{:else if status === "error"}
		<div class="px-4 py-6 text-[12px] text-muted-foreground/70">
			Could not load project settings.
		</div>
	{:else}
		<SettingRow
			label="Hide external CLI sessions"
			description="When enabled, non-Acepe sessions discovered from Claude, Cursor, Codex, and OpenCode are hidden for this project."
		>
			<Switch
				checked={hideExternalCliSessions}
				disabled={isSavingVisibility}
				onCheckedChange={(checked) => {
					void saveVisibility(checked === true);
				}}
			/>
		</SettingRow>

		<SettingRow
			label="Setup Script"
			description="Runs after Acepe creates a worktree for this project. Stored as one full shell script."
			stacked={true}
		>
			<div class="flex flex-col gap-2">
				<ScriptEditor
					value={setupScriptDraft}
					onChange={(v) => (setupScriptDraft = v)}
					highlight={shikiHighlight}
					disabled={isSavingSetupScript}
					minLines={7}
					maxLines={20}
					placeholder={"bun install\nbun run check"}
					ariaLabel="Setup script"
				/>
				<div class="flex items-center justify-between gap-3">
					<div class="text-[11px] text-muted-foreground/60">
						Blank value clears the script.
					</div>
					<Button
						size="sm"
						variant="secondary"
						disabled={isSavingSetupScript}
						onclick={() => {
							void saveScript("setup_script");
						}}
					>
						{isSavingSetupScript ? "Saving..." : "Save setup script"}
					</Button>
				</div>
			</div>
		</SettingRow>

		<SettingRow
			label="Run Script"
			description="Stored per project now for the upcoming workspace-run hook. Stored as one full shell script."
			stacked={true}
		>
			<div class="flex flex-col gap-2">
				<ScriptEditor
					value={runScriptDraft}
					onChange={(v) => (runScriptDraft = v)}
					highlight={shikiHighlight}
					disabled={isSavingRunScript}
					minLines={7}
					maxLines={20}
					placeholder={"bun run dev"}
					ariaLabel="Run script"
				/>
				<div class="flex items-center justify-between gap-3">
					<div class="text-[11px] text-muted-foreground/60">
						Blank value clears the script.
					</div>
					<Button
						size="sm"
						variant="secondary"
						disabled={isSavingRunScript}
						onclick={() => {
							void saveScript("run_script");
						}}
					>
						{isSavingRunScript ? "Saving..." : "Save run script"}
					</Button>
				</div>
			</div>
		</SettingRow>
	{/if}
</SettingsSection>
