/**
 * State manager for the ExitPlanMode tool UI.
 *
 * Handles parsing plan content and extracting structured data for display.
 */
import type { SessionPlanResponse } from "$lib/services/converted-session-types.js";

import type { PermissionRequest } from "../../../../types/permission.js";
import type { ToolCall } from "../../../../types/tool-call.js";

import { type ParsedPlan, parsePlanMarkdown } from "../../../../utils/plan-parser.js";

/**
 * Raw input structure from the ExitPlanMode tool.
 */
interface PlanModeRawInput {
	plan?: string;
	planFilePath?: string;
	planPath?: string;
	filePath?: string;
	allowedPrompts?: string[];
}

/**
 * State manager for ExitPlanMode tool calls.
 *
 * Uses the getter pattern for reactivity with Svelte 5 runes.
 */
export class PlanModeState {
	private readonly getToolCall: () => ToolCall;
	private readonly getPermission: () => PermissionRequest | undefined;
	private readonly getSessionPlan: () => SessionPlanResponse | null;

	constructor(
		getToolCall: () => ToolCall,
		getPermission: () => PermissionRequest | undefined,
		getSessionPlan: () => SessionPlanResponse | null = () => null
	) {
		this.getToolCall = getToolCall;
		this.getPermission = getPermission;
		this.getSessionPlan = getSessionPlan;
	}

	/**
	 * Whether the tool call is currently live (pending or in_progress).
	 */
	isLive = $derived.by(() => {
		const toolCall = this.getToolCall();
		return toolCall.status === "pending" || toolCall.status === "in_progress";
	});

	/**
	 * Whether we're waiting for user approval.
	 */
	isPendingApproval = $derived.by(() => {
		return this.getPermission() !== undefined;
	});

	/**
	 * The raw plan content from the permission metadata or session plan.
	 * For live requests, uses permission metadata.
	 * For historical data, uses the session plan content.
	 */
	planContent = $derived.by((): string | null => {
		// First try permission metadata (live requests)
		const permission = this.getPermission();
		if (permission?.metadata) {
			const rawInput = permission.metadata.rawInput as PlanModeRawInput | undefined;
			if (rawInput?.plan) return rawInput.plan;
		}

		// Fallback to session plan content (historical data)
		const sessionPlan = this.getSessionPlan();
		return sessionPlan?.content ?? null;
	});

	/**
	 * Parsed plan data with title, summary, todos, and file path.
	 */
	parsedPlan = $derived.by((): ParsedPlan | null => {
		const content = this.planContent;
		if (!content) return null;
		return parsePlanMarkdown(content);
	});

	/**
	 * The plan title from the parsed content or session plan.
	 */
	title = $derived.by(() => {
		// Try session plan title first (most accurate for historical)
		const sessionPlan = this.getSessionPlan();
		if (sessionPlan?.title) return sessionPlan.title;

		// Then try parsed content
		if (this.parsedPlan?.title) return this.parsedPlan.title;

		// Fallback to tool call title or default
		return this.getToolCall().title ?? "Plan";
	});

	/**
	 * The plan slug from the session plan (filename without .md).
	 * This is the most reliable source for the plan filename.
	 */
	planSlug = $derived.by((): string | null => {
		return this.getSessionPlan()?.slug ?? null;
	});

	/**
	 * The plan file path from session plan, rawInput, or parsed content.
	 * Session plan file_path is the most reliable source.
	 */
	planFilePath = $derived.by((): string | null => {
		// First try session plan file_path (most reliable - from backend)
		const sessionPlan = this.getSessionPlan();
		if (sessionPlan?.filePath) return sessionPlan.filePath;

		// Then try permission metadata (for live requests)
		const permission = this.getPermission();
		if (permission?.metadata) {
			const rawInput = permission.metadata.rawInput as PlanModeRawInput | undefined;
			if (rawInput?.planFilePath) return rawInput.planFilePath;
			if (rawInput?.planPath) return rawInput.planPath;
			if (rawInput?.filePath) return rawInput.filePath;
		}

		// Fallback to parsed content
		return this.parsedPlan?.filePath ?? null;
	});

	/**
	 * The filename for display.
	 * Uses slug from session plan if available, otherwise extracts from file path.
	 */
	fileName = $derived.by((): string | null => {
		// First try to use the slug from session plan (most reliable)
		const slug = this.planSlug;
		if (slug) {
			return `${slug}.md`;
		}

		// Fallback to extracting from file path
		const filePath = this.planFilePath;
		if (!filePath) return null;
		return filePath.split("/").pop() ?? filePath;
	});

	/**
	 * Allowed prompts for interactive follow-up.
	 */
	allowedPrompts = $derived.by((): string[] => {
		const permission = this.getPermission();
		if (!permission?.metadata) return [];

		const rawInput = permission.metadata.rawInput as PlanModeRawInput | undefined;
		return rawInput?.allowedPrompts ?? [];
	});

	/**
	 * Number of completed todos.
	 */
	completedTodosCount = $derived.by(() => {
		const todos = this.parsedPlan?.todos ?? [];
		return todos.filter((t) => t.isCompleted).length;
	});

	/**
	 * Total number of todos.
	 */
	totalTodosCount = $derived.by(() => {
		return this.parsedPlan?.todos?.length ?? 0;
	});

	/**
	 * Whether there are todos to display.
	 */
	hasTodos = $derived.by(() => {
		return this.totalTodosCount > 0;
	});
}
