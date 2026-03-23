import { z } from "zod";

import { ContentBlockSchema } from "./content-block.schema.js";

/**
 * Tool Call Content Schema per ACP protocol specification.
 *
 * ToolCallContent is a discriminated union of content types that can appear
 * in tool call results. This extends the base ACP types with additional
 * semantic types for rich UI rendering.
 *
 * Base ACP types:
 * - content: Wrapped ContentBlock (text, image, audio, etc.)
 * - diff: File diff with old/new text
 * - terminal: Terminal reference
 *
 * Extended types (for rich UI):
 * - question: User question with options
 * - todo: Todo list items
 *
 * @see https://agentclientprotocol.com/protocol/tool-calls#content
 */

// === Base ACP Types ===

/**
 * Wrapped ContentBlock - standard message content in tool results.
 */
export const ContentWrapperSchema = z.object({
	type: z.literal("content"),
	content: ContentBlockSchema,
});

/**
 * Diff content - file changes with optional old text.
 */
export const DiffContentSchema = z.object({
	type: z.literal("diff"),
	path: z.string(),
	oldText: z.string().nullable().optional(),
	newText: z.string(),
});

/**
 * Terminal content - reference to a terminal session.
 */
export const TerminalContentSchema = z.object({
	type: z.literal("terminal"),
	terminalId: z.string(),
});

// === Extended Types for Rich UI ===

/**
 * Question option schema.
 */
export const QuestionOptionSchema = z.object({
	label: z.string(),
	description: z.string().optional(),
});

/**
 * Single question schema.
 */
export const QuestionItemSchema = z.object({
	question: z.string(),
	header: z.string().optional(),
	multiSelect: z.boolean().optional(),
	options: z.array(QuestionOptionSchema).optional(),
});

/**
 * Question content - user questions with options.
 * Used by AskUserQuestion tool.
 */
export const QuestionContentSchema = z.object({
	type: z.literal("question"),
	questions: z.array(QuestionItemSchema),
});

/**
 * Todo item schema.
 */
export const TodoItemSchema = z.object({
	content: z.string(),
	status: z.enum(["pending", "in_progress", "completed"]),
	activeForm: z.string().optional(),
});

/**
 * Todo content - todo list items.
 * Used by TodoWrite tool.
 */
export const TodoContentSchema = z.object({
	type: z.literal("todo"),
	todos: z.array(TodoItemSchema),
});

/**
 * Skill content - skill invocation metadata.
 * Used by Skill tool.
 */
export const SkillContentSchema = z.object({
	type: z.literal("skill"),
	skill: z.string(),
	args: z.string().optional(),
	description: z.string().optional(),
	filePath: z.string().optional(),
});

/**
 * Task/Agent content - subagent task metadata.
 * Used by Task tool.
 */
export const TaskContentSchema = z.object({
	type: z.literal("task"),
	description: z.string().optional(),
	prompt: z.string().optional(),
	subagentType: z.string().optional(),
});

// === Combined Schema ===

/**
 * ToolCallContent - discriminated union of all tool call content types.
 */
export const ToolCallContentSchema = z.discriminatedUnion("type", [
	// Base ACP types
	ContentWrapperSchema,
	DiffContentSchema,
	TerminalContentSchema,
	// Extended types
	QuestionContentSchema,
	TodoContentSchema,
	SkillContentSchema,
	TaskContentSchema,
]);

/**
 * TypeScript types inferred from schemas.
 */
export type ContentWrapper = z.infer<typeof ContentWrapperSchema>;
export type DiffContent = z.infer<typeof DiffContentSchema>;
export type TerminalContent = z.infer<typeof TerminalContentSchema>;
export type QuestionOption = z.infer<typeof QuestionOptionSchema>;
export type QuestionItem = z.infer<typeof QuestionItemSchema>;
export type QuestionContent = z.infer<typeof QuestionContentSchema>;
export type TodoItem = z.infer<typeof TodoItemSchema>;
export type TodoContent = z.infer<typeof TodoContentSchema>;
export type SkillContent = z.infer<typeof SkillContentSchema>;
export type TaskContent = z.infer<typeof TaskContentSchema>;
export type ToolCallContent = z.infer<typeof ToolCallContentSchema>;

/**
 * Type guard for content wrapper.
 */
export function isContentWrapper(content: ToolCallContent): content is ContentWrapper {
	return content.type === "content";
}

/**
 * Type guard for diff content.
 */
export function isDiffContent(content: ToolCallContent): content is DiffContent {
	return content.type === "diff";
}

/**
 * Type guard for terminal content.
 */
export function isTerminalContent(content: ToolCallContent): content is TerminalContent {
	return content.type === "terminal";
}

/**
 * Type guard for question content.
 */
export function isQuestionContent(content: ToolCallContent): content is QuestionContent {
	return content.type === "question";
}

/**
 * Type guard for todo content.
 */
export function isTodoContent(content: ToolCallContent): content is TodoContent {
	return content.type === "todo";
}

/**
 * Type guard for skill content.
 */
export function isSkillContent(content: ToolCallContent): content is SkillContent {
	return content.type === "skill";
}

/**
 * Type guard for task content.
 */
export function isTaskContent(content: ToolCallContent): content is TaskContent {
	return content.type === "task";
}

/**
 * Validate and parse tool call content.
 * Returns the parsed content or null if invalid.
 */
export function parseToolCallContent(data: unknown): ToolCallContent | null {
	const result = ToolCallContentSchema.safeParse(data);
	return result.success ? result.data : null;
}

/**
 * Validate an array of tool call content.
 * Returns only the valid items.
 */
export function parseToolCallContentArray(data: unknown[]): ToolCallContent[] {
	return data.map(parseToolCallContent).filter((item): item is ToolCallContent => item !== null);
}
