import type { RpcCompactionProjectedMessage } from "@acepe/contracts";
import type { AgentSessionActivityEntry } from "@acepe/ui/agent-panel/types";

const TRIGGER_LABEL = {
	auto: "Auto",
	manual: "Manual",
	unknown: "Unknown",
} as const;

const formatTokenCount = (value: number | null): string | null => {
	if (value === null) {
		return null;
	}
	return value.toLocaleString("en-US");
};

const cleanDisplayText = (value: string | null): string | null => {
	if (value === null) {
		return null;
	}
	const text = value.trim();
	if (text.length === 0) {
		return null;
	}
	return text;
};

const titleForCompaction = (content: RpcCompactionProjectedMessage["content"]): string => {
	const summary = cleanDisplayText(content.summary);
	if (summary !== null) {
		return summary;
	}
	if (content.status === "preparing") {
		return "Compaction preparing";
	}
	if (content.status === "failed") {
		return "Compaction failed";
	}
	return "Compaction done";
};

const subtitleForCompaction = (
	content: RpcCompactionProjectedMessage["content"]
): string | null => {
	const droppedTokens = formatTokenCount(content.droppedTokens);
	if (droppedTokens !== null) {
		return `${droppedTokens} tokens freed`;
	}
	if (content.status === "usage_reset") {
		return "Context meter reset";
	}
	return null;
};

const hasAnyUsageValue = (content: RpcCompactionProjectedMessage["content"]): boolean =>
	content.preCompactionTokens !== null ||
	content.postCompactionTokens !== null ||
	content.contextWindowSize !== null;

export const compactionEntryFromProjectedMessage = (
	message: RpcCompactionProjectedMessage
): AgentSessionActivityEntry => {
	const entry: AgentSessionActivityEntry = {
		id: message.messageId,
		type: "session_activity",
		activityKind: "compaction",
		title: titleForCompaction(message.content),
		status: message.content.status,
	};
	if (message.content.status === "preparing") {
		return entry;
	}
	const subtitle = subtitleForCompaction(message.content);
	if (subtitle !== null) {
		entry.subtitle = subtitle;
	}
	if (hasAnyUsageValue(message.content)) {
		entry.contextUsage = {
			preCompactionTokens: message.content.preCompactionTokens,
			postCompactionTokens: message.content.postCompactionTokens,
			contextWindowSize: message.content.contextWindowSize,
		};
	}
	entry.metadata = [
		{
			label: "Trigger",
			value: TRIGGER_LABEL[message.content.trigger],
		},
	];
	return entry;
};
