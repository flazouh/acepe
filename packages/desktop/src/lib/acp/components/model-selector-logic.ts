/**
 * Model Selector Logic
 *
 * Pure functions for model selector display and grouping logic.
 * Extracted for testability and reuse.
 */

import type { Model } from "../application/dto/model.js";

import { AGENT_IDS } from "../types/agent-id.js";

/**
 * Capitalizes the first letter of each word in a string.
 */
function capitalizeName(name: string): string {
	return name
		.split(/\s+/)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
		.join(" ");
}

/**
 * Gets the display name for a model.
 *
 * For Claude Code: Extracts model name from description format "Model Name · Description text"
 * For other agents: Uses the model name directly with proper capitalization
 *
 * @param model - The model to get display name for
 * @param agentId - The agent ID, used to determine extraction behavior
 * @returns The display name for the model
 */
export function getModelDisplayName(model: Model, agentId: string | null): string {
	// For Claude Code, try to extract model name from description (format: "Model Name · Description")
	if (agentId === AGENT_IDS.CLAUDE_CODE && model.description) {
		const parts = model.description.split(" · ");
		if (parts.length >= 2 && parts[0].trim()) {
			const firstPart = parts[0].trim();

			// For "default" model, extract actual model name from "Use the default model (currently X)"
			if (model.id === "default") {
				const match = firstPart.match(/\(currently\s+(.+?)\)/);
				if (match?.[1]) {
					return `${match[1]} (default)`;
				}
			}

			return firstPart;
		}
	}

	// Use model name directly (capitalize first letter of each word)
	return capitalizeName(model.name);
}

/**
 * Extracts the provider from a model ID.
 *
 * Handles formats:
 * - "anthropic/claude-3" -> "Anthropic"
 * - "openai:gpt-4" -> "Openai"
 * - "google.gemini-pro" -> "Google"
 * - "default" -> "Default"
 * - "opus" -> "Other" (no separator)
 *
 * @param modelId - The model ID to extract provider from
 * @returns Capitalized provider name or "Other" if not found
 */
export function getProviderFromModelId(modelId: string): string {
	if (modelId === "default") return "Default";

	const parts = modelId.split(/[/:.]/);
	if (parts.length > 1 && parts[0]) {
		return capitalizeName(parts[0]);
	}

	return "Other";
}

/**
 * Model group containing provider name and its models.
 */
export interface ModelGroup {
	provider: string;
	models: Model[];
}

/**
 * Groups models by their provider and sorts them.
 *
 * - Filters out models with undefined id
 * - Groups by provider extracted from id
 * - Sorts with "Default" first, then alphabetically
 *
 * @param models - Array of models to group
 * @returns Sorted array of model groups
 */
export function groupModelsByProvider(models: readonly Model[]): ModelGroup[] {
	// Filter out models with undefined id
	const validModels = models.filter((m) => m.id);

	// Group by provider
	const groups: Record<string, Model[]> = {};

	for (const model of validModels) {
		const provider = getProviderFromModelId(model.id);
		if (!groups[provider]) {
			groups[provider] = [];
		}
		groups[provider].push(model);
	}

	// Sort providers: Default first, then alphabetically
	const sortedKeys = Object.keys(groups).sort((a, b) => {
		if (a === "Default") return -1;
		if (b === "Default") return 1;
		return a.localeCompare(b);
	});

	// Sort models within each provider alphabetically by name
	return sortedKeys.map((provider) => ({
		provider,
		models: [...groups[provider]].sort((a, b) =>
			(a.name ?? a.id).localeCompare(b.name ?? b.id, undefined, { sensitivity: "base" })
		),
	}));
}

export function isDefaultModel(defaultModelId: string | undefined, modelId: string): boolean {
	return defaultModelId === modelId;
}

export const CODEX_REASONING_EFFORTS = ["low", "medium", "high", "xhigh"] as const;

export type CodexReasoningEffort = (typeof CODEX_REASONING_EFFORTS)[number];

export interface CodexModelVariant {
	fullModelId: string;
	baseModelId: string;
	effort: CodexReasoningEffort;
	name: string;
	description?: string;
}

export interface CodexBaseModelGroup {
	baseModelId: string;
	baseModelName: string;
	variants: CodexModelVariant[];
}

function toEffort(value: string): CodexReasoningEffort | null {
	const match = CODEX_REASONING_EFFORTS.find((effort) => effort === value);
	return match ?? null;
}

function getEffortOrder(effort: CodexReasoningEffort): number {
	return CODEX_REASONING_EFFORTS.indexOf(effort);
}

export function parseCodexModelVariant(model: Model): CodexModelVariant | null {
	const slashIndex = model.id.lastIndexOf("/");
	if (slashIndex <= 0 || slashIndex >= model.id.length - 1) {
		return null;
	}

	const baseModelId = model.id.slice(0, slashIndex);
	const effortValue = model.id.slice(slashIndex + 1);
	const effort = toEffort(effortValue);
	if (!effort) {
		return null;
	}

	return {
		fullModelId: model.id,
		baseModelId,
		effort,
		name: model.name,
		description: model.description,
	};
}

export function groupCodexModelsByBase(models: readonly Model[]): CodexBaseModelGroup[] {
	const grouped = new Map<string, CodexModelVariant[]>();
	const displayNameByBase = new Map<string, string>();

	for (const model of models) {
		const variant = parseCodexModelVariant(model);
		if (!variant) {
			continue;
		}

		const current = grouped.get(variant.baseModelId) ?? [];
		current.push(variant);
		grouped.set(variant.baseModelId, current);
		if (!displayNameByBase.has(variant.baseModelId)) {
			displayNameByBase.set(variant.baseModelId, capitalizeName(variant.baseModelId));
		}
	}

	const baseGroups = Array.from(grouped.entries())
		.map(([baseModelId, variants]) => ({
			baseModelId,
			baseModelName: displayNameByBase.get(baseModelId) ?? capitalizeName(baseModelId),
			variants: variants.sort((a, b) => getEffortOrder(a.effort) - getEffortOrder(b.effort)),
		}))
		.sort((a, b) => a.baseModelName.localeCompare(b.baseModelName));

	return baseGroups;
}

export function getCodexCurrentVariant(
	baseGroups: readonly CodexBaseModelGroup[],
	currentModelId: string | null
): CodexModelVariant | null {
	if (baseGroups.length === 0) {
		return null;
	}

	if (currentModelId) {
		const exact = baseGroups
			.flatMap((group) => group.variants)
			.find((variant) => variant.fullModelId === currentModelId);
		if (exact) {
			return exact;
		}

		const group = baseGroups.find((candidate) => candidate.baseModelId === currentModelId);
		if (group?.variants[0]) {
			return group.variants[0];
		}
	}

	return baseGroups[0]?.variants[0] ?? null;
}

export function supportsReasoningEffortPicker(models: readonly Model[]): boolean {
	const validModels = models.filter((model) => model.id);
	if (validModels.length === 0) {
		return false;
	}

	const parsedCount = validModels.filter((model) => parseCodexModelVariant(model) !== null).length;
	if (parsedCount !== validModels.length) {
		return false;
	}

	const groups = groupCodexModelsByBase(validModels);
	return groups.some((group) => group.variants.length > 1);
}
