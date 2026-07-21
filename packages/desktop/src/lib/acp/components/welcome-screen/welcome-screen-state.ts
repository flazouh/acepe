import type { ProviderBrand } from "@acepe/ui";
import type { ProjectWithSessions } from "../add-repository/project-discovery.js";

export const SPLASH_AGENTS: readonly { brand: ProviderBrand; alt: string }[] = [
	{ brand: "claude-code", alt: "Claude" },
	{ brand: "copilot", alt: "GitHub Copilot" },
	{ brand: "codex", alt: "Codex" },
	{ brand: "cursor", alt: "Cursor" },
	{ brand: "opencode", alt: "OpenCode" },
];

// Vendor labels grounded in product data, not marketing copy.
export const AGENT_VENDORS: Readonly<Record<string, string>> = {
	"claude-code": "Anthropic",
	cursor: "Cursor",
	copilot: "GitHub",
	opencode: "SST",
	codex: "OpenAI",
};

export type OnboardingStep = "splash" | "agents" | "projects" | "scanning";

// Visible steps for the progress indicator. Scanning is an internal transition.
export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
	"splash",
	"agents",
	"projects",
] as const;

export function getCurrentOnboardingStepIndex(onboardingStep: OnboardingStep): number {
	return onboardingStep === "scanning" ? 2 : ONBOARDING_STEPS.indexOf(onboardingStep);
}

export function extractNameFromPath(path: string): string {
	const segments = path.split("/").filter((segment) => segment.length > 0);
	return segments.length > 0 ? (segments[segments.length - 1] ?? path) : path;
}

/**
 * Filters projects to show only those with sessions from selected agents.
 * If no agents are selected, shows all projects.
 */
export function filterProjectsBySelectedAgents(
	projects: ProjectWithSessions[],
	selectedAgentIds: string[]
): ProjectWithSessions[] {
	if (selectedAgentIds.length === 0) {
		return projects;
	}

	const selectedSet = new Set(selectedAgentIds);

	return projects.filter((project) => {
		return Array.from(selectedSet).some((agentId) => {
			const count = project.agentCounts.get(agentId);
			return typeof count === "number" && count > 0;
		});
	});
}

export function toggleSelectedOnboardingAgent(
	selectedAgentIds: readonly string[],
	agentId: string
): string[] {
	const nextSelectedAgentIds = new Set(selectedAgentIds);

	if (nextSelectedAgentIds.has(agentId)) {
		if (nextSelectedAgentIds.size === 1) {
			return [...selectedAgentIds];
		}
		nextSelectedAgentIds.delete(agentId);
		return Array.from(nextSelectedAgentIds);
	}

	nextSelectedAgentIds.add(agentId);
	return Array.from(nextSelectedAgentIds);
}
