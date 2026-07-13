<script lang="ts">
import { InterfaceIcon, RoundedIcon } from "@acepe/ui";
import type { ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";
import AgentsModelsSection from "./sections/agents-models-section.svelte";
import AppearanceSection from "./sections/appearance-section.svelte";
import ArchivedSessionsSection from "./sections/archived-sessions-section.svelte";
import ChatSection from "./sections/chat-section.svelte";
import EnvironmentsSection from "./sections/environments-section.svelte";
import GeneralSection from "./sections/general-section.svelte";
import GitSection from "./sections/git-section.svelte";
import KeybindingsSection from "./sections/keybindings-section.svelte";
import McpSection from "./sections/mcp-section.svelte";
import ProjectSection from "./sections/project-section.svelte";
import SkillsSection from "./sections/skills-section.svelte";
import UsageSection from "./sections/usage-section.svelte";
import SettingsPageHeader from "./settings-page-header.svelte";
import { getSettingsSectionDefinition } from "./settings-section-registry.js";
import SettingsSidebar from "./settings-sidebar.svelte";
import { migrateSettingsSectionId, type SettingsSectionId } from "./settings-types.js";

interface Props {
	projectManager?: ProjectManager;
	initialSection?: string;
	/** When provided, a top "Back" bar is shown (full-screen settings). */
	onBack?: () => void;
}

let { projectManager, initialSection, onBack }: Props = $props();

// One-time seed from optional `initialSection`; user tab changes are local only after that.
// svelte-ignore state_referenced_locally
let activeSection = $state<SettingsSectionId>(
	initialSection != null && initialSection !== ""
		? migrateSettingsSectionId(initialSection)
		: "general"
);

const activeSectionDefinition = $derived(getSettingsSectionDefinition(activeSection));

function handleSectionChange(section: SettingsSectionId) {
	activeSection = section;
}
</script>

<!-- Left nav panel (floating card, matches the app sidebar) -->
<aside
	class="flex h-full w-[240px] shrink-0 flex-col overflow-hidden rounded-lg border border-border/50 bg-card/75"
>
	<!-- Header band: same height/padding/border as the app sidebar header -->
	<div class="flex h-7 shrink-0 items-center gap-0.5 border-b border-border/50 px-1">
		{#if onBack}
			<button
				type="button"
				onclick={onBack}
				aria-label="Back"
				class="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
			>
				<InterfaceIcon name="chevron-left" class="size-3.5" />
				<span>Back</span>
			</button>
		{/if}
	</div>
	<div class="min-h-0 flex-1 overflow-y-auto">
		<SettingsSidebar {activeSection} onSectionChange={handleSectionChange} />
	</div>
</aside>

<!-- Content panel (floating card, matches the agent panel) -->
<main
	class="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border/50 bg-card/75"
>
	<SettingsPageHeader
		title={activeSectionDefinition.label}
		description={activeSectionDefinition.description}
		centered={activeSectionDefinition.fullWidth !== true}
	/>

	<div class="min-h-0 flex-1 overflow-auto px-6 py-5">
		<div
			class={activeSectionDefinition.fullWidth === true
				? "flex h-full min-h-0 w-full flex-col"
				: "mx-auto w-full max-w-3xl"}
		>
			{#if activeSection === "general"}
				<GeneralSection />
			{:else if activeSection === "appearance"}
				<AppearanceSection />
			{:else if activeSection === "agents"}
				<AgentsModelsSection />
			{:else if activeSection === "chat"}
				<ChatSection />
			{:else if activeSection === "skills"}
				<SkillsSection />
			{:else if activeSection === "keybindings"}
				<KeybindingsSection />
			{:else if activeSection === "mcp"}
				<McpSection />
			{:else if activeSection === "git"}
				<GitSection />
			{:else if activeSection === "project"}
				{#if projectManager}
					<ProjectSection {projectManager} />
				{:else}
					<p class="text-[12px] text-muted-foreground/70">
						Project settings are only available from the main app view.
					</p>
				{/if}
			{:else if activeSection === "environments"}
				<EnvironmentsSection />
			{:else if activeSection === "archived"}
				{#if projectManager}
					<ArchivedSessionsSection {projectManager} />
				{:else}
					<p class="text-[12px] text-muted-foreground/70">
						Archived sessions are only available from the main app view.
					</p>
				{/if}
			{:else if activeSection === "usage"}
				<UsageSection />
			{/if}
		</div>
	</div>
</main>
