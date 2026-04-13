<script lang="ts">
	import { AgentPanelPreSessionWorktreeCard as SharedPreSessionWorktreeCard } from "@acepe/ui/agent-panel";
	import * as m from "$lib/paraglide/messages.js";
	import { tauriClient } from "$lib/utils/tauri-client.js";
	import { getWorktreeDefaultStore } from "../../worktree-toggle/worktree-default-store.svelte.js";
	import SetupScriptsDialog from "./setup-scripts-dialog.svelte";

	interface Props {
		projectPath: string;
		projectName: string;
		pendingWorktreeEnabled: boolean;
		globalWorktreeDefault: boolean;
		failureMessage?: string | null;
		onPendingWorktreeChange: (enabled: boolean) => void;
		onRetryWorktree?: () => void;
		onStartInProjectRoot?: () => void;
	}

	let {
		projectPath,
		projectName,
		pendingWorktreeEnabled,
		globalWorktreeDefault,
		failureMessage = null,
		onPendingWorktreeChange,
		onRetryWorktree,
		onStartInProjectRoot,
	}: Props = $props();

	const worktreeDefaultStore = getWorktreeDefaultStore();

	let setupScriptsOpen = $state(false);
	let setupCommandCount = $state<number | null>(null);

	const setupCommandsSummary = $derived.by(() => {
		if (setupCommandCount === null) {
			return "Loading setup commands";
		}

		if (setupCommandCount === 0) {
			return "No setup commands";
		}

		return `${setupCommandCount} setup command${setupCommandCount === 1 ? "" : "s"}`;
	});

	$effect(() => {
		let cancelled = false;
		void tauriClient.git.loadWorktreeConfig(projectPath).match(
			(config) => {
				if (cancelled) {
					return;
				}
				setupCommandCount = config?.setupCommands.length ?? 0;
			},
			() => {
				if (cancelled) {
					return;
				}
				setupCommandCount = 0;
			}
		);

		return () => {
			cancelled = true;
		};
	});
</script>

<SharedPreSessionWorktreeCard
	title="Session workspace"
	sessionScopeLabel="This session"
	futureScopeLabel="Future sessions"
	worktreeLabel="Worktree"
	projectRootLabel="Project root"
	setupCommandsLabel={m.setup_scripts_dialog_title()}
	{setupCommandsSummary}
	globalDefaultEnabled={globalWorktreeDefault}
	{pendingWorktreeEnabled}
	{failureMessage}
	retryLabel="Retry worktree"
	startInProjectRootLabel="Start in project root"
	onPendingWorktreeChange={onPendingWorktreeChange}
	onGlobalDefaultChange={(enabled) => {
		void worktreeDefaultStore.set(enabled);
	}}
	onOpenSetupCommands={() => {
		setupScriptsOpen = true;
	}}
	{onRetryWorktree}
	{onStartInProjectRoot}
/>

<SetupScriptsDialog
	open={setupScriptsOpen}
	onOpenChange={(value) => (setupScriptsOpen = value)}
	{projectPath}
	{projectName}
/>
