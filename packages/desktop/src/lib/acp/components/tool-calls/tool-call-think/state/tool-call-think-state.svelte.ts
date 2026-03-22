import type { QuestionItem } from "$lib/services/converted-session-types.js";
import type { TurnState } from "../../../../store/types.js";
import type { ToolCall } from "../../../../types/tool-call.js";

import { extractSkillCallInput } from "../../../../utils/extract-skill-call-input.js";

/**
 * Tool type classification for think operations.
 */
export type ThinkToolType = "todo" | "question" | "task" | "skill" | "think";

/**
 * State manager for tool-call-think component.
 *
 * Uses content-based detection to determine tool type, making the system
 * agent-agnostic. The backend normalizes all agent-specific formats into
 * unified structures (e.g., normalizedQuestions for all question tools).
 */
export class ToolCallThinkState {
	/**
	 * Getter function for the tool call to ensure reactivity.
	 */
	private readonly getToolCall: () => ToolCall;

	/**
	 * Getter function for the turn state to ensure reactivity.
	 */
	private readonly getTurnState: () => TurnState | undefined;

	constructor(getToolCall: () => ToolCall, getTurnState?: () => TurnState | undefined) {
		this.getToolCall = getToolCall;
		this.getTurnState = getTurnState ?? (() => undefined);
	}

	/**
	 * Get the tool type directly from Rust-provided ToolKind.
	 *
	 * Rust sets the correct ToolKind from the start (todo, question, task, skill, think),
	 * so we simply map it to ThinkToolType. No detection logic needed.
	 */
	toolType = $derived.by((): ThinkToolType => {
		const toolCall = this.getToolCall();
		const kind = toolCall.kind;

		// Map ToolKind to ThinkToolType
		// Rust provides specific kinds: "todo", "question", "task", "skill", "think"
		if (kind === "todo") return "todo";
		if (kind === "question") return "question";
		if (kind === "task") return "task";
		if (kind === "skill") return "skill";

		// Default to "think" for think kind and any other kinds routed here
		return "think";
	});

	/**
	 * Get normalized questions from the backend.
	 * The Rust streaming accumulator parses all agent-specific question formats
	 * into this unified structure with progressive updates.
	 */
	questions = $derived.by((): QuestionItem[] | null => {
		const toolCall = this.getToolCall();
		const questions = toolCall.normalizedQuestions;
		return questions && questions.length > 0 ? questions : null;
	});

	/**
	 * Check if we have questions available.
	 */
	hasQuestions = $derived.by(() => {
		return this.questions !== null && this.questions.length > 0;
	});

	/**
	 * Check if current question allows multiple selections.
	 */
	isMultiSelect = $derived.by(() => {
		if (!this.questions?.[0]) return false;
		return this.questions[0].multiSelect ?? false;
	});

	/**
	 * Extract subagent data for Task tools.
	 */
	subagent = $derived.by(() => {
		const toolCall = this.getToolCall();
		if (this.toolType !== "task") return null;
		if (toolCall.arguments.kind === "think") {
			return {
				subagentType: toolCall.arguments.subagent_type,
				description: toolCall.arguments.description,
				prompt: toolCall.arguments.prompt,
			};
		}
		return null;
	});

	/**
	 * Extract skill data for Skill tools.
	 */
	skill = $derived.by(() => {
		const toolCall = this.getToolCall();
		if (this.toolType !== "skill") return null;
		return extractSkillCallInput(toolCall.arguments);
	});

	/**
	 * Extract skill metadata (description and file path) for Skill tools.
	 */
	skillMeta = $derived.by(() => {
		const toolCall = this.getToolCall();
		if (this.toolType !== "skill") return null;
		return toolCall.skillMeta ?? null;
	});

	/**
	 * Extract description for generic think tools.
	 */
	description = $derived.by(() => {
		const toolCall = this.getToolCall();
		if (toolCall.arguments.kind === "think") {
			return toolCall.arguments.description;
		}
		return null;
	});

	/**
	 * Determine if the tool call is currently live (in progress or pending).
	 *
	 * A tool is only truly "live" when:
	 * 1. The tool status is "in_progress" or "pending", AND
	 * 2. The session is actively streaming (turnState === "streaming")
	 *
	 * When the session is interrupted (turnState === "idle"), tools that were
	 * in progress should not show as running since the agent is no longer working.
	 */
	isLive = $derived.by(() => {
		const toolCall = this.getToolCall();
		const turnState = this.getTurnState();

		const toolIsActive = toolCall.status === "in_progress" || toolCall.status === "pending";
		const sessionIsActive = turnState === "streaming";

		// Tool is live only if both the tool and the session are active
		return toolIsActive && sessionIsActive;
	});
}
