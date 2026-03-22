/**
 * Parser for command output XML tags from Claude SDK.
 *
 * The Claude SDK returns slash command outputs with XML-style tags:
 * <command-name>/model</command-name>
 * <command-message>model</command-message>
 * <command-args></command-args>
 * <local-command-stdout>Set model to...</local-command-stdout>
 *
 * These tags may come together or separately in different messages.
 */

/**
 * Parsed command output structure.
 */
export interface CommandOutput {
	/** The command name, e.g., "/model" */
	command: string;
	/** The command message, e.g., "model" */
	message: string;
	/** Command arguments */
	args: string;
	/** The stdout output from the command */
	stdout: string;
}

/**
 * A segment of parsed text - either regular text or a command output.
 */
export type ParsedSegment =
	| { type: "text"; content: string }
	| { type: "command_output"; content: CommandOutput };

/**
 * Individual tag patterns - allow whitespace/newlines between tags
 */
const LOCAL_STDOUT_PATTERN = /<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/;

/**
 * Full pattern with all tags (allows newlines/whitespace between them)
 */
const FULL_COMMAND_PATTERN =
	/<command-name>([^<]*)<\/command-name>[\s\S]*?<command-message>([^<]*)<\/command-message>[\s\S]*?<command-args>([^<]*)<\/command-args>[\s\S]*?<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/g;

/**
 * Pattern for command header tags only (without stdout)
 */
const HEADER_ONLY_PATTERN =
	/<command-name>([^<]*)<\/command-name>[\s\S]*?<command-message>([^<]*)<\/command-message>[\s\S]*?<command-args>([^<]*)<\/command-args>/g;

/**
 * Check if text contains any command output tags.
 */
export function hasCommandOutput(text: string): boolean {
	return text.includes("<local-command-stdout>") || text.includes("<command-name>");
}

/**
 * Parse text containing command output tags into segments.
 * Handles:
 * - Full pattern (all tags together)
 * - Header only (<command-name>, <command-message>, <command-args>)
 * - Stdout only (<local-command-stdout>)
 *
 * @param text - The text to parse
 * @returns Array of segments (text or command output)
 */
export function parseCommandOutput(text: string): ParsedSegment[] {
	const segments: ParsedSegment[] = [];
	let remainingText = text;

	// First, try to match the full pattern with all tags
	FULL_COMMAND_PATTERN.lastIndex = 0;
	let fullMatch: RegExpExecArray | null;
	let lastIndex = 0;

	// biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec loop
	while ((fullMatch = FULL_COMMAND_PATTERN.exec(text)) !== null) {
		// Add any text before this match
		if (fullMatch.index > lastIndex) {
			const textBefore = text.slice(lastIndex, fullMatch.index).trim();
			if (textBefore) {
				segments.push({ type: "text", content: textBefore });
			}
		}

		segments.push({
			type: "command_output",
			content: {
				command: fullMatch[1].trim(),
				message: fullMatch[2].trim(),
				args: fullMatch[3].trim(),
				stdout: fullMatch[4].trim(),
			},
		});

		lastIndex = fullMatch.index + fullMatch[0].length;
	}

	// If we found full matches, handle remaining text
	if (lastIndex > 0) {
		if (lastIndex < text.length) {
			const textAfter = text.slice(lastIndex).trim();
			if (textAfter) {
				segments.push({ type: "text", content: textAfter });
			}
		}
		return segments;
	}

	// No full matches - try partial patterns
	remainingText = text;

	// Try header-only pattern (command-name + message + args, no stdout)
	HEADER_ONLY_PATTERN.lastIndex = 0;
	const headerMatch = HEADER_ONLY_PATTERN.exec(remainingText);
	if (headerMatch) {
		// Add text before
		if (headerMatch.index > 0) {
			const textBefore = remainingText.slice(0, headerMatch.index).trim();
			if (textBefore) {
				segments.push({ type: "text", content: textBefore });
			}
		}

		segments.push({
			type: "command_output",
			content: {
				command: headerMatch[1].trim(),
				message: headerMatch[2].trim(),
				args: headerMatch[3].trim(),
				stdout: "",
			},
		});

		// Add text after
		const afterIndex = headerMatch.index + headerMatch[0].length;
		if (afterIndex < remainingText.length) {
			const textAfter = remainingText.slice(afterIndex).trim();
			if (textAfter) {
				segments.push({ type: "text", content: textAfter });
			}
		}

		return segments;
	}

	// Try standalone stdout pattern
	const stdoutMatch = LOCAL_STDOUT_PATTERN.exec(remainingText);
	if (stdoutMatch) {
		// Add text before
		if (stdoutMatch.index > 0) {
			const textBefore = remainingText.slice(0, stdoutMatch.index).trim();
			if (textBefore) {
				segments.push({ type: "text", content: textBefore });
			}
		}

		segments.push({
			type: "command_output",
			content: {
				command: "",
				message: "",
				args: "",
				stdout: stdoutMatch[1].trim(),
			},
		});

		// Add text after
		const afterIndex = stdoutMatch.index + stdoutMatch[0].length;
		if (afterIndex < remainingText.length) {
			const textAfter = remainingText.slice(afterIndex).trim();
			if (textAfter) {
				segments.push({ type: "text", content: textAfter });
			}
		}

		return segments;
	}

	// No command output tags found - return original text
	if (text.trim()) {
		segments.push({ type: "text", content: text });
	}

	return segments;
}
