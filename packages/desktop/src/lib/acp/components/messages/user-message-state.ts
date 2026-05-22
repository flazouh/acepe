import type { UserMessage } from "../../types/user-message.js";
import {
	type CommandOutput,
	hasCommandOutput,
	parseCommandOutput,
} from "../../utils/command-output-parser.js";

export type ProcessedUserMessageChunk =
	| { type: "text"; text: string }
	| { type: "block"; block: UserMessage["chunks"][number] }
	| { type: "command_output"; output: CommandOutput };

export interface UserMessageDisplayState {
	processedChunks: ProcessedUserMessageChunk[];
	isOnlyCommandOutput: boolean;
}

export function buildUserMessageDisplayState(message: UserMessage): UserMessageDisplayState {
	const processedChunks = processUserMessageChunks(message.chunks);

	return {
		processedChunks,
		isOnlyCommandOutput:
			processedChunks.length > 0 &&
			processedChunks.every((chunk) => chunk.type === "command_output"),
	};
}

export function processUserMessageChunks(
	chunks: UserMessage["chunks"]
): ProcessedUserMessageChunk[] {
	return chunks.flatMap((chunk): ProcessedUserMessageChunk[] => {
		if (chunk.type !== "text") {
			return [{ type: "block", block: chunk }];
		}

		const text = chunk.text;
		if (!text.trim()) {
			return [];
		}

		if (!hasCommandOutput(text)) {
			return [{ type: "text", text }];
		}

		return parseCommandOutput(text).flatMap((segment): ProcessedUserMessageChunk[] => {
			if (segment.type === "command_output") {
				return [{ type: "command_output", output: segment.content }];
			}

			if (segment.content) {
				return [{ type: "text", text: segment.content }];
			}

			return [];
		});
	});
}
