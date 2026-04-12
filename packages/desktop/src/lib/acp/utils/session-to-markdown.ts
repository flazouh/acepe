import type { ContentBlock, ToolCallData } from "../../services/converted-session-types.js";
import type { SessionEntry } from "../application/dto/session.js";

/**
 * Extract plain text from a content block.
 */
function blockToText(block: ContentBlock): string {
	if (block.type === "text" && typeof block.text === "string") {
		return block.text;
	}
	if (block.type === "resource_link") {
		return block.title ?? block.name ?? block.uri ?? "";
	}
	return "";
}

/**
 * Extract text from user message content (ContentBlock or array).
 */
function userContentToText(content: ContentBlock | readonly ContentBlock[]): string {
	if (Array.isArray(content)) {
		return content.map((b) => blockToText(b)).join("\n");
	}
	return blockToText(content as ContentBlock);
}

/**
 * Extract text from assistant message chunks.
 */
function assistantChunksToText(
	chunks: ReadonlyArray<{ type: string; block: ContentBlock }>
): string {
	return chunks.map((chunk) => (chunk.block.type === "text" ? chunk.block.text : "")).join("");
}

/**
 * Get tool call target/summary for display.
 */
function getToolTarget(tool: ToolCallData): string {
	const args = tool.arguments;
	if (!args) return tool.name ?? String(tool.kind ?? "tool");

	switch (args.kind) {
		case "read":
		case "delete":
			return args.file_path ?? "";
		case "edit":
			return args.edits[0]?.file_path ?? "";
		case "execute":
			return args.command ?? "";
		case "search":
			return args.query ?? args.file_path ?? "";
		case "glob":
			return args.pattern ?? args.path ?? "";
		case "webSearch":
			return args.query ?? "";
		case "fetch":
			return args.url ?? "";
		default:
			return tool.name ?? tool.kind ?? "";
	}
}

/**
 * Convert session entries to readable markdown.
 */
export function sessionEntriesToMarkdown(entries: ReadonlyArray<SessionEntry>): string {
	const lines: string[] = [];

	for (const entry of entries) {
		switch (entry.type) {
			case "user": {
				const text = userContentToText(entry.message.content);
				if (text.trim()) {
					lines.push("## User\n");
					lines.push(text.trim());
					lines.push("\n");
				}
				break;
			}
			case "assistant": {
				const text = assistantChunksToText(entry.message.chunks);
				if (text.trim()) {
					lines.push("## Assistant\n");
					lines.push(text.trim());
					lines.push("\n");
				}
				break;
			}
			case "tool_call": {
				const target = getToolTarget(entry.message);
				const name = entry.message.name ?? String(entry.message.kind ?? "Tool");
				lines.push(`## Tool: ${name}\n`);
				if (target) {
					lines.push(target);
					lines.push("\n");
				}
				break;
			}
			case "ask": {
				lines.push("## Question\n");
				lines.push(typeof entry.message.question === "string" ? entry.message.question : "");
				lines.push("\n");
				break;
			}
			case "error": {
				lines.push("## Error\n");
				lines.push(entry.message.content ?? "Unknown error");
				lines.push("\n");
				break;
			}
		}
	}

	return lines.join("").trim();
}
