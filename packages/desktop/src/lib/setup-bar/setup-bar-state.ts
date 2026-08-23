import type {
	ConfigOptionData,
	ProjectedSkillsCatalog,
	RpcSessionSnapshot,
} from "@acepe/contracts";
import type { AgentInputConfigOption } from "@acepe/ui/agent-panel";
import type {
	ComposerSetupBarServer,
	ComposerSetupBarSkill,
} from "@acepe/ui/agent-panel";

export const SETUP_BAR_COPY = {
	skillsHeading: "Skills",
	mcpHeading: "MCP servers",
	optionsHeading: "Setup",
} as const;

export const LIBRARY_SETUP_PROJECT_ID = "library-project-1";
export const LIBRARY_SETUP_PROJECT_ROOT = "/tmp/acepe";
export const LIBRARY_SETUP_PROVIDER_ID = "claude-code";

const toCurrentValue = (
	value: ConfigOptionData["currentValue"],
): string | number | boolean | null => {
	if (value === undefined || value === null) {
		return null;
	}
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
		return value;
	}
	return null;
};

const toOptionChoices = (
	options: ConfigOptionData["options"],
): AgentInputConfigOption["options"] => {
	if (options === undefined) {
		return undefined;
	}
	const mapped: Array<{ value: string | number | boolean; name: string }> = [];
	for (const option of options) {
		if (
			typeof option.value === "string" ||
			typeof option.value === "number" ||
			typeof option.value === "boolean"
		) {
			mapped.push({
				value: option.value,
				name: option.name,
			});
		}
	}
	return mapped;
};

export const mapConfigOptionToAgentInput = (
	option: ConfigOptionData,
): AgentInputConfigOption | null => {
	const presentation = option.presentation ?? "advanced";
	if (presentation === "hidden") {
		return null;
	}
	return {
		id: option.id,
		name: option.name,
		category: option.category,
		type: option.type,
		description: option.description,
		currentValue: toCurrentValue(option.currentValue),
		options: toOptionChoices(option.options),
		presentation,
	};
};

export const mapSkillsToSetupBarRows = (
	catalog: ProjectedSkillsCatalog | null,
): ReadonlyArray<ComposerSetupBarSkill> => {
	if (catalog === null) {
		return [];
	}
	const rows: Array<ComposerSetupBarSkill> = [];
	for (const group of catalog.agentSkills) {
		for (const skill of group.skills) {
			rows.push({
				id: skill.id,
				name: skill.name,
			});
		}
	}
	return rows;
};

export const mapMcpServersToSetupBarRows = (
	snapshot: RpcSessionSnapshot,
): ReadonlyArray<ComposerSetupBarServer> => {
	const catalog = snapshot.mcpCatalog?.catalog;
	if (catalog === undefined) {
		return [];
	}
	return catalog.servers.map((server) => ({
		id: server.id,
		name: server.name,
		status: server.status,
	}));
};

export const mapPreconnectionOptionsToAgentInput = (
	snapshot: RpcSessionSnapshot,
): ReadonlyArray<AgentInputConfigOption> => {
	const options = snapshot.preconnectionOptions?.options;
	if (options === undefined) {
		return [];
	}
	const mapped: Array<AgentInputConfigOption> = [];
	for (const option of options) {
		const next = mapConfigOptionToAgentInput(option);
		if (next !== null) {
			mapped.push(next);
		}
	}
	return mapped;
};

export const mergeSetupBarSnapshots = (
	skillsSnap: RpcSessionSnapshot,
	mcpSnap: RpcSessionSnapshot,
): RpcSessionSnapshot => {
	const snapshotSequence =
		skillsSnap.snapshotSequence > mcpSnap.snapshotSequence
			? skillsSnap.snapshotSequence
			: mcpSnap.snapshotSequence;
	return {
		snapshotSequence,
		session: mcpSnap.session,
		messages: mcpSnap.messages,
		turns: mcpSnap.turns,
		activities: mcpSnap.activities,
		pendingApprovals: mcpSnap.pendingApprovals,
		checkpoints: mcpSnap.checkpoints,
		projects: mcpSnap.projects,
		sessions: mcpSnap.sessions,
		settings: mcpSnap.settings,
		skillsCatalog: skillsSnap.skillsCatalog,
		voice: mcpSnap.voice,
		gitReview: mcpSnap.gitReview,
		mcpCatalog: mcpSnap.mcpCatalog,
		preconnectionOptions: mcpSnap.preconnectionOptions,
	};
};
