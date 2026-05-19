import type {
	OperationSnapshot,
	SessionStateGraph,
	ToolArguments,
	TranscriptEntry,
} from "../../services/acp-types.js";

function transcriptSegmentText(entry: TranscriptEntry): string {
	let text = "";
	for (const segment of entry.segments) {
		text += segment.text;
	}
	return text;
}

function operationTarget(args: ToolArguments): string {
	switch (args.kind) {
		case "read":
			return args.file_path ?? "";
		case "delete":
			return args.file_path ?? args.file_paths?.[0] ?? "";
		case "edit":
			return args.edits[0]?.filePath ?? "";
		case "execute":
			return args.command ?? "";
		case "shellInput":
			return args.shell_id && args.input
				? `Shell ${args.shell_id}: ${args.input}`
				: (args.input ?? args.shell_id ?? "");
		case "search":
			return args.query ?? args.file_path ?? "";
		case "glob":
			return args.pattern ?? args.path ?? "";
		case "webSearch":
			return args.query ?? "";
		case "fetch":
			return args.url ?? "";
		case "think":
			return args.description ?? args.prompt ?? args.skill ?? "";
		case "taskOutput":
			return args.task_id ?? "";
		case "move":
			return args.from && args.to ? `${args.from} -> ${args.to}` : (args.from ?? args.to ?? "");
		case "planMode":
			return args.mode ?? "";
		case "toolSearch":
			return args.query ?? "";
		case "sql":
			return args.query ?? args.description ?? "";
		case "unclassified":
			return args.arguments_preview ?? args.title ?? args.provider_name;
		case "readLints":
		case "browser":
		case "other":
			return "";
	}
}

function operationsByTranscriptEntryId(
	operations: readonly OperationSnapshot[]
): ReadonlyMap<string, OperationSnapshot> {
	const byEntryId = new Map<string, OperationSnapshot>();
	for (const operation of operations) {
		if (operation.source_link.kind !== "transcript_linked") {
			continue;
		}
		byEntryId.set(operation.source_link.entry_id, operation);
	}
	return byEntryId;
}

/**
 * Convert the canonical session graph to readable markdown.
 */
export function sessionGraphToMarkdown(graph: SessionStateGraph): string {
	const lines: string[] = [];
	const operationByEntryId = operationsByTranscriptEntryId(graph.operations);

	for (const entry of graph.transcriptSnapshot.entries) {
		switch (entry.role) {
			case "user": {
				const text = transcriptSegmentText(entry);
				if (text.trim()) {
					lines.push("## User\n");
					lines.push(text.trim());
					lines.push("\n");
				}
				break;
			}
			case "assistant": {
				const text = transcriptSegmentText(entry);
				if (text.trim()) {
					lines.push("## Assistant\n");
					lines.push(text.trim());
					lines.push("\n");
				}
				break;
			}
			case "tool": {
				const operation = operationByEntryId.get(entry.entryId);
				const name = operation?.title ?? operation?.name ?? transcriptSegmentText(entry) ?? "Tool";
				const target = operation ? operationTarget(operation.arguments) : transcriptSegmentText(entry);
				lines.push(`## Tool: ${name}\n`);
				if (target.trim()) {
					lines.push(target.trim());
					lines.push("\n");
				}
				break;
			}
			case "error": {
				const text = transcriptSegmentText(entry);
				lines.push("## Error\n");
				lines.push(text.trim() || "Unknown error");
				lines.push("\n");
				break;
			}
		}
	}

	return lines.join("").trim();
}
