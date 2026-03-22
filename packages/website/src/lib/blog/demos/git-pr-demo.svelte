<script lang="ts">
	/**
	 * Demo: Git PR Viewer
	 * Shows the GitViewer component with mock PR data.
	 */
	import { GitViewer, type GitPrData } from '@acepe/ui';

	const pr: GitPrData = {
		number: 342,
		title: 'Redesign settings page with new tab layout',
		author: 'bob-dev',
		state: 'merged',
		description:
			'Migrates the settings page from a single long scroll to a tabbed interface.\nEach settings category (General, Appearance, Keys, Advanced) gets its own tab.',
		files: [
			{ path: 'src/routes/settings/+page.svelte', status: 'modified', additions: 45, deletions: 112 },
			{ path: 'src/routes/settings/tabs/general.svelte', status: 'added', additions: 38, deletions: 0 },
			{ path: 'src/routes/settings/tabs/appearance.svelte', status: 'added', additions: 52, deletions: 0 },
			{ path: 'src/routes/settings/tabs/keys.svelte', status: 'added', additions: 31, deletions: 0 },
			{ path: 'src/routes/settings/tabs/advanced.svelte', status: 'added', additions: 28, deletions: 0 },
			{ path: 'src/lib/components/tab-nav.svelte', status: 'added', additions: 24, deletions: 0 },
			{ path: 'src/routes/settings/settings.css', status: 'deleted', additions: 0, deletions: 67 },
		],
		githubUrl: 'https://github.com/example/project/pull/342',
	};

	const MOCK_DIFFS: Record<string, string> = {
		'src/routes/settings/+page.svelte': [
			'-   import GeneralSettings from "./general-settings.svelte";',
			'-   import AppearanceSettings from "./appearance-settings.svelte";',
			'-   import KeySettings from "./key-settings.svelte";',
			'-   import AdvancedSettings from "./advanced-settings.svelte";',
			'+   import TabNav from "$lib/components/tab-nav.svelte";',
			'+   import General from "./tabs/general.svelte";',
			'+   import Appearance from "./tabs/appearance.svelte";',
			'+   import Keys from "./tabs/keys.svelte";',
			'+   import Advanced from "./tabs/advanced.svelte";',
			'+',
			'+   let activeTab = $state("general");',
			'+',
			'+   const tabs = [',
			'+     { id: "general", label: "General" },',
			'+     { id: "appearance", label: "Appearance" },',
			'+     { id: "keys", label: "Keys" },',
			'+     { id: "advanced", label: "Advanced" },',
			'+   ];',
			'',
			'- <div class="settings-page">',
			'-   <h1>Settings</h1>',
			'-   <GeneralSettings />',
			'-   <AppearanceSettings />',
			'-   <KeySettings />',
			'-   <AdvancedSettings />',
			'- </div>',
			'+ <div class="flex flex-col gap-4">',
			'+   <TabNav {tabs} bind:active={activeTab} />',
			'+   {#if activeTab === "general"}<General />',
			'+   {:else if activeTab === "appearance"}<Appearance />',
			'+   {:else if activeTab === "keys"}<Keys />',
			'+   {:else if activeTab === "advanced"}<Advanced />',
			'+   {/if}',
			'+ </div>',
		].join('\n'),
	};

	let selectedFile = $state(pr.files[0].path);
	let viewMode = $state<'inline' | 'side-by-side'>('inline');
</script>

<p class="demo-hint">
	This shows a merged pull request. Notice the purple merge icon and status badge.
</p>

<div class="viewer-wrapper">
		<GitViewer
			data={{ type: 'pr', pr }}
			{selectedFile}
			{viewMode}
			onSelectFile={(path) => (selectedFile = path)}
			onChangeViewMode={(mode) => (viewMode = mode)}
		>
			{#snippet diffContent({ file })}
				{@const mockDiff = MOCK_DIFFS[file.path]}
				{#if mockDiff}
					<div class="mock-diff">
						{#each mockDiff.split('\n') as line, i (i)}
							<div
								class="diff-line"
								class:line-add={line.startsWith('+')}
								class:line-del={line.startsWith('-')}
								class:line-ctx={!line.startsWith('+') && !line.startsWith('-')}
							>
								<span class="line-marker">
									{#if line.startsWith('+')}<span class="text-success">+</span>
									{:else if line.startsWith('-')}<span class="text-destructive">-</span>
									{:else}<span>&nbsp;</span>{/if}
								</span>
								<code>{line.startsWith('+') || line.startsWith('-') ? line.slice(1) : line}</code>
							</div>
						{/each}
					</div>
				{:else}
					<div class="no-diff">
						<p class="text-muted-foreground text-sm">Diff preview not available for this file</p>
					</div>
				{/if}
			{/snippet}
		</GitViewer>
</div>

<style>
	.demo-hint {
		margin-bottom: 1rem;
		padding: 0.75rem;
		border-radius: 0.375rem;
		background: hsl(var(--muted) / 0.5);
		color: hsl(var(--muted-foreground));
		font-size: 0.875rem;
		text-align: center;
	}

	.viewer-wrapper {
		height: 420px;
		border-radius: 0.5rem;
		border: 1px solid hsl(var(--border) / 0.3);
		overflow: hidden;
	}

	.mock-diff {
		font-family: ui-monospace, 'SF Mono', Monaco, monospace;
		font-size: 12px;
		line-height: 1.6;
		padding: 8px 0;
	}

	.diff-line {
		display: flex;
		padding: 0 12px;
	}

	.line-marker {
		width: 20px;
		flex-shrink: 0;
		text-align: center;
		user-select: none;
	}

	.line-add {
		background: hsl(var(--success) / 0.08);
	}

	.line-del {
		background: hsl(var(--destructive) / 0.08);
	}

	code {
		background: transparent;
		padding: 0;
		color: inherit;
		font-size: inherit;
	}

	.no-diff {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		padding: 2rem;
	}
</style>
