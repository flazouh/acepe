<script lang="ts">
	import { Button, HugeiconsIcon, type HugeiconsIconName } from "@acepe/ui";

	import { Badge } from "$lib/components/ui/badge/index.js";
	import SettingsPageHeader from "$lib/components/settings-page/settings-page-header.svelte";
	import { cn } from "$lib/utils.js";

	import DesignSystemClaudeSparkSection from "./design-system-claude-spark-section.svelte";
	import { claudeSparkSectionMeta } from "./design-system-claude-spark-specimens.js";
	import DesignSystemCompactionActivitySection from "./design-system-compaction-activity-section.svelte";
	import { compactionActivitySectionMeta } from "./design-system-compaction-activity-specimens.js";
	import DesignSystemControlTokensSection from "./design-system-control-tokens-section.svelte";
	import { controlTokensSectionMeta } from "./design-system-control-tokens-specimens.js";
	import DesignSystemInstallCardSection from "./design-system-install-card-section.svelte";
	import { installCardSectionMeta } from "./design-system-install-card-specimens.js";
	import DesignSystemMicButtonSection from "./design-system-mic-button-section.svelte";
	import { micButtonSectionMeta } from "./design-system-mic-button-specimens.js";
	import DesignSystemNewThreadOptionsSection from "./design-system-new-thread-options-section.svelte";
	import { newThreadOptionsSectionMeta } from "./design-system-new-thread-options-specimens.js";
	import DesignSystemPrCardSection from "./design-system-pr-card-section.svelte";
	import { prCardSectionMeta } from "./design-system-pr-card-specimens.js";
	import DesignSystemReviewWorkspaceSection from "./design-system-review-workspace-section.svelte";
	import { reviewWorkspaceSectionMeta } from "./design-system-review-workspace-specimens.js";
	import DesignSystemTaskToolSection from "./design-system-task-tool-section.svelte";
	import { taskToolSectionMeta } from "./design-system-task-tool-specimens.js";
	import DesignSystemUpdateCardSection from "./design-system-update-card-section.svelte";
	import { updateCardSectionMeta } from "./design-system-update-card-specimens.js";

	interface Props {
		onClose: () => void;
	}

	let { onClose }: Props = $props();

	type DesignSystemSection =
		| "control-tokens"
		| "claude-spark"
		| "compaction-activity"
		| "install-card"
		| "mic-button"
		| "new-thread-options"
		| "pr-card"
		| "review-workspace"
		| "task-tool"
		| "update-card";

	const sections: ReadonlyArray<{ id: DesignSystemSection; label: string }> = [
		{ id: "control-tokens", label: controlTokensSectionMeta.title },
		{ id: "claude-spark", label: claudeSparkSectionMeta.title },
		{ id: "compaction-activity", label: compactionActivitySectionMeta.title },
		{ id: "install-card", label: installCardSectionMeta.title },
		{ id: "mic-button", label: micButtonSectionMeta.title },
		{ id: "new-thread-options", label: newThreadOptionsSectionMeta.title },
		{ id: "pr-card", label: prCardSectionMeta.title },
		{ id: "review-workspace", label: reviewWorkspaceSectionMeta.title },
		{ id: "task-tool", label: taskToolSectionMeta.title },
		{ id: "update-card", label: updateCardSectionMeta.title },
	];

	const sectionMetaById = {
		"control-tokens": controlTokensSectionMeta,
		"claude-spark": claudeSparkSectionMeta,
		"compaction-activity": compactionActivitySectionMeta,
		"install-card": installCardSectionMeta,
		"mic-button": micButtonSectionMeta,
		"new-thread-options": newThreadOptionsSectionMeta,
		"pr-card": prCardSectionMeta,
		"review-workspace": reviewWorkspaceSectionMeta,
		"task-tool": taskToolSectionMeta,
		"update-card": updateCardSectionMeta,
	} as const;

	let activeSection = $state<DesignSystemSection>("control-tokens");

	const activeSectionMeta = $derived(sectionMetaById[activeSection]);

	function roundedSectionIcon(sectionId: DesignSystemSection): HugeiconsIconName | null {
		if (sectionId === "control-tokens") return "sliders";
		if (sectionId === "claude-spark") return "sparkle";
		if (sectionId === "compaction-activity") return "archive";
		if (sectionId === "install-card") return "download";
		if (sectionId === "mic-button") return "microphone";
		if (sectionId === "new-thread-options") return "new-chat";
		if (sectionId === "pr-card") return "pull-request";
		if (sectionId === "review-workspace") return "review";
		if (sectionId === "task-tool") return "tasks";
		if (sectionId === "update-card") return "download";
		return null;
	}

	const sectionShellClass = $derived(
		activeSection === "control-tokens"
			? "w-full min-w-0"
			: activeSection === "review-workspace"
				? "w-full max-w-5xl"
				: "w-full max-w-4xl",
	);
</script>

<div class="relative flex h-full min-h-0 w-full overflow-hidden" data-testid="design-system-page">
	<nav
		class="flex w-[208px] shrink-0 flex-col overflow-y-auto border-r border-border/40 px-2 py-2"
		aria-label="Design system sections"
	>
		<div class="px-2 pb-1 pt-1">
			<p class="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground/55">
				Components
			</p>
		</div>
		<div class="flex flex-col gap-0.5 pb-1">
			{#each sections as section (section.id)}
				{@const isActive = activeSection === section.id}
				{@const RoundedSectionIcon = roundedSectionIcon(section.id)}
				<button
					type="button"
					onclick={() => {
						activeSection = section.id;
					}}
					aria-current={isActive ? "page" : undefined}
					class={cn(
						"flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium transition-colors",
						"hover:bg-accent hover:text-foreground",
						isActive ? "bg-accent text-foreground" : "text-muted-foreground"
					)}
					>
					{#if RoundedSectionIcon}
						<HugeiconsIcon name={RoundedSectionIcon} class="size-3.5 shrink-0" />
					{/if}
					<span class="truncate">{section.label}</span>
				</button>
			{/each}
		</div>
	</nav>

	<div class="flex min-h-0 min-w-0 flex-1 flex-col">
		<div class="flex shrink-0 items-center justify-between gap-3 border-b border-border/40 px-4 py-2">
			<Button variant="ghost" size="sm" onclick={onClose} aria-label="Back to app" class="-ml-2 gap-1.5">
				<HugeiconsIcon name="chevron-left" class="size-3" />
				Back to app
			</Button>
			<Badge variant="outline" class="font-mono text-[10px] uppercase tracking-wider">
				Dev
			</Badge>
		</div>

		<SettingsPageHeader
			title={activeSectionMeta.title}
			description={activeSectionMeta.description}
		/>

		<main class="min-h-0 flex-1 overflow-auto p-4">
			<div class={sectionShellClass}>
				{#if activeSection === "control-tokens"}
					<DesignSystemControlTokensSection />
				{:else if activeSection === "claude-spark"}
					<DesignSystemClaudeSparkSection />
				{:else if activeSection === "compaction-activity"}
					<DesignSystemCompactionActivitySection />
				{:else if activeSection === "install-card"}
					<DesignSystemInstallCardSection />
				{:else if activeSection === "mic-button"}
					<DesignSystemMicButtonSection />
				{:else if activeSection === "new-thread-options"}
					<DesignSystemNewThreadOptionsSection />
				{:else if activeSection === "pr-card"}
					<DesignSystemPrCardSection />
				{:else if activeSection === "review-workspace"}
					<DesignSystemReviewWorkspaceSection />
				{:else if activeSection === "task-tool"}
					<DesignSystemTaskToolSection />
				{:else if activeSection === "update-card"}
					<DesignSystemUpdateCardSection />
				{/if}
			</div>
		</main>
	</div>
</div>
