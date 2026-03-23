/**
 * Plan Parser - Parses plan markdown content to extract structured data.
 *
 * Used by the ExitPlanMode tool UI to display plan details like title,
 * summary, and todo items.
 */

/**
 * A todo item extracted from a plan.
 */
export interface ParsedTodo {
	/** The todo content text */
	content: string;
	/** Whether the todo is completed */
	isCompleted: boolean;
}

/**
 * Parsed plan data extracted from markdown content.
 */
export interface ParsedPlan {
	/** The plan title (from first # heading) */
	title: string;
	/** The plan summary (first paragraph or content under ## Summary) */
	summary: string | null;
	/** Todo items extracted from checklist syntax */
	todos: ParsedTodo[];
	/** The file path where the plan is stored (if found in content) */
	filePath: string | null;
}

/**
 * Extract the file path from plan content.
 * Looks for patterns like "File to Modify" or file paths in code blocks.
 */
function extractFilePath(content: string): string | null {
	// Look for explicit file path patterns
	const filePatterns = [
		/##\s*File(?:s)?\s+to\s+Modify\s*\n+[`-]*\s*`?([^\n`]+)`?/i,
		/plan\s+file[:\s]+`?([^\n`]+\.plan\.md)`?/i,
		/([a-zA-Z0-9_/-]+\.plan\.md)/,
	];

	for (const pattern of filePatterns) {
		const match = content.match(pattern);
		if (match?.[1]) {
			return match[1].trim();
		}
	}

	return null;
}

/**
 * Extract the title from the first # heading.
 */
function extractTitle(content: string): string {
	const lines = content.split("\n");

	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.startsWith("# ")) {
			return trimmed.slice(2).trim();
		}
	}

	return "Plan";
}

/**
 * Extract summary from the content.
 * Looks for:
 * 1. Content under ## Summary heading
 * 2. First non-empty paragraph after the title
 */
function extractSummary(content: string): string | null {
	const lines = content.split("\n");

	// First, try to find ## Summary section
	let inSummarySection = false;
	const summaryLines: string[] = [];

	for (const line of lines) {
		const trimmed = line.trim();

		if (trimmed.match(/^##\s+Summary/i)) {
			inSummarySection = true;
			continue;
		}

		if (inSummarySection) {
			// Stop at next heading
			if (trimmed.startsWith("#")) {
				break;
			}
			if (trimmed) {
				summaryLines.push(trimmed);
			}
		}
	}

	if (summaryLines.length > 0) {
		return summaryLines.join(" ").slice(0, 200);
	}

	// Fallback: find first paragraph after title
	let foundTitle = false;
	let skipEmptyLines = true;

	for (const line of lines) {
		const trimmed = line.trim();

		if (trimmed.startsWith("# ")) {
			foundTitle = true;
			skipEmptyLines = true;
			continue;
		}

		if (!foundTitle) continue;

		// Skip empty lines after title
		if (skipEmptyLines && !trimmed) continue;
		skipEmptyLines = false;

		// Stop at headings or code blocks
		if (trimmed.startsWith("#") || trimmed.startsWith("```")) {
			break;
		}

		// Found a paragraph
		if (trimmed && !trimmed.startsWith("-") && !trimmed.startsWith("*")) {
			return trimmed.slice(0, 200);
		}
	}

	return null;
}

/**
 * Extract todo items from checklist syntax.
 * Supports:
 * - [ ] Uncompleted item
 * - [x] Completed item
 * - [X] Completed item (uppercase)
 */
function extractTodos(content: string): ParsedTodo[] {
	const todos: ParsedTodo[] = [];
	const lines = content.split("\n");

	// Match checklist patterns: - [ ], - [x], - [X], * [ ], etc.
	const todoPattern = /^[\s]*[-*]\s*\[([ xX])\]\s*(.+)$/;

	for (const line of lines) {
		const match = line.match(todoPattern);
		if (match) {
			const [, checkmark, text] = match;
			todos.push({
				content: text.trim(),
				isCompleted: checkmark.toLowerCase() === "x",
			});
		}
	}

	return todos;
}

/**
 * Parse plan markdown content to extract structured data.
 *
 * @param content - The raw markdown content of the plan
 * @returns Parsed plan with title, summary, todos, and file path
 */
export function parsePlanMarkdown(content: string): ParsedPlan {
	if (!content || typeof content !== "string") {
		return {
			title: "Plan",
			summary: null,
			todos: [],
			filePath: null,
		};
	}

	return {
		title: extractTitle(content),
		summary: extractSummary(content),
		todos: extractTodos(content),
		filePath: extractFilePath(content),
	};
}
