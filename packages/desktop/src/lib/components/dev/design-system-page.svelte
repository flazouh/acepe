<script lang="ts">
	import { Button } from "@acepe/ui";
	import { CaretLeft, DownloadSimple, Microphone, Rows, Sparkle } from "phosphor-svelte";

	import { Badge } from "$lib/components/ui/badge/index.js";
	import SettingsPageHeader from "$lib/components/settings-page/settings-page-header.svelte";
	import { cn } from "$lib/utils.js";

	import DesignSystemClaudeSparkSection from "./design-system-claude-spark-section.svelte";
	import { claudeSparkSectionMeta } from "./design-system-claude-spark-specimens.js";
	import DesignSystemInstallCardSection from "./design-system-install-card-section.svelte";
	import { installCardSectionMeta } from "./design-system-install-card-specimens.js";
	import DesignSystemMicButtonSection from "./design-system-mic-button-section.svelte";
	import { micButtonSectionMeta } from "./design-system-mic-button-specimens.js";
	import DesignSystemNewThreadOptionsSection from "./design-system-new-thread-options-section.svelte";
	import { newThreadOptionsSectionMeta } from "./design-system-new-thread-options-specimens.js";

	interface Props {
		onClose: () => void;
	}

	let { onClose }: Props = $props();

	type DesignSystemSection =
		| "claude-spark"
		| "install-card"
		| "mic-button"
		| "new-thread-options";

	const sections: ReadonlyArray<{ id: DesignSystemSection; label: string }> = [
		{ id: "claude-spark", label: claudeSparkSectionMeta.title },
		{ id: "install-card", label: installCardSectionMeta.title },
		{ id: "mic-button", label: micButtonSectionMeta.title },
		{ id: "new-thread-options", label: newThreadOptionsSectionMeta.title },
	];

	const sectionMetaById = {
		"claude-spark": claudeSparkSectionMeta,
		"install-card": installCardSectionMeta,
		"mic-button": micButtonSectionMeta,
		"new-thread-options": newThreadOptionsSectionMeta,
	} as const;

	let activeSection = $state<DesignSystemSection>("claude-spark");

	const activeSectionMeta = $derived(sectionMetaById[activeSection]);

	function sectionIcon(sectionId: DesignSystemSection) {
		if (sectionId === "claude-spark") return Sparkle;
		if (sectionId === "new-thread-options") return Rows;
		if (sectionId === "mic-button") return Microphone;
		return DownloadSimple;
	}
</script>

<div class="relative flex h-full min-h-0 w-full overflow-hidden">
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
				{@const SectionIcon = sectionIcon(section.id)}
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
					<SectionIcon weight="fill" class="size-3.5 shrink-0" />
					<span class="truncate">{section.label}</span>
				</button>
			{/each}
		</div>
	</nav>

	<div class="flex min-h-0 min-w-0 flex-1 flex-col">
		<div class="flex shrink-0 items-center justify-between gap-3 border-b border-border/40 px-4 py-2">
			<Button variant="ghost" size="sm" onclick={onClose} aria-label="Back to app" class="-ml-2 gap-1.5">
				<CaretLeft size={12} weight="bold" />
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
			<div class="w-full max-w-4xl">
				{#if activeSection === "claude-spark"}
					<DesignSystemClaudeSparkSection />
				{:else if activeSection === "install-card"}
					<DesignSystemInstallCardSection />
				{:else if activeSection === "mic-button"}
					<DesignSystemMicButtonSection />
				{:else if activeSection === "new-thread-options"}
					<DesignSystemNewThreadOptionsSection />
				{/if}
			</div>
		</main>
	</div>
</div>
