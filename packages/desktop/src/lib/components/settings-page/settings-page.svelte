<script lang="ts">
import {
	CloseAction,
	EmbeddedPanelHeader,
	HeaderActionCell,
	HeaderTitleCell,
} from "@acepe/ui/panel-header";
import type { ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";
import KeybindingsTab from "$lib/components/settings/keybindings-tab.svelte";
import ProjectTab from "$lib/components/settings/project-tab.svelte";
import * as m from "$lib/paraglide/messages.js";
import AgentsModelsSection from "./sections/agents-models-section.svelte";

import ArchivedSessionsSection from "./sections/archived-sessions-section.svelte";
import ChatSection from "./sections/chat-section.svelte";
import GeneralSection from "./sections/general-section.svelte";
import SkillsSection from "./sections/skills-section.svelte";
import WorktreesSection from "./sections/worktrees-section.svelte";
import SettingsSidebar from "./settings-sidebar.svelte";
import type { SettingsSectionId } from "./settings-types.js";

interface Props {
	projectManager?: ProjectManager;
	onClose?: () => void;
}

let { projectManager, onClose }: Props = $props();

let activeSection = $state<SettingsSectionId>("general");

function handleSectionChange(section: SettingsSectionId) {
	activeSection = section;
}
</script>

<div class="h-full w-full flex flex-col bg-background overflow-hidden">
	<!-- Embedded header -->
	<EmbeddedPanelHeader>
		<HeaderTitleCell>
			<span class="sr-only">
				{m.settings_title()}
			</span>
		</HeaderTitleCell>
		<HeaderActionCell>
			<CloseAction onClose={() => onClose?.()} title={m.common_close()} />
		</HeaderActionCell>
	</EmbeddedPanelHeader>

	<div class="flex flex-1 overflow-hidden min-h-0">
		<!-- Sidebar -->
		<SettingsSidebar {activeSection} onSectionChange={handleSectionChange} />

		<!-- Main content -->
		<main class="flex-1 min-w-0 min-h-0 overflow-auto px-14 pt-8 pb-14 text-[13px] lg:px-16 lg:pt-10 lg:pb-16 xl:px-20 xl:pt-12 xl:pb-20">
			{#if activeSection === "general"}
				<GeneralSection />
			{:else if activeSection === "chat"}
				<ChatSection />
			{:else if activeSection === "keybindings"}
				<div class="h-full w-full flex flex-col">
					<KeybindingsTab />
				</div>
			{:else if activeSection === "agents"}
				<AgentsModelsSection />
			{:else if activeSection === "skills"}
				<SkillsSection />
			{:else if activeSection === "worktrees"}
				<WorktreesSection />
			{:else if activeSection === "project"}
				{#if projectManager}
					<div class="h-full w-full flex flex-col">
						<ProjectTab {projectManager} />
					</div>
				{:else}
					<div class="text-[12px] text-muted-foreground/50">
						Project settings are only available from the main app view.
					</div>
				{/if}
			{:else if activeSection === "archived"}
				{#if projectManager}
					<ArchivedSessionsSection {projectManager} />
				{:else}
					<div class="text-[12px] text-muted-foreground/50">
						Archived sessions are only available from the main app view.
					</div>
				{/if}
			{/if}
		</main>
	</div>
</div>
