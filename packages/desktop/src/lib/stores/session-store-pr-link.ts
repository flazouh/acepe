import {
	type CommandId,
	type RpcSessionSnapshot,
	type SessionId,
	SessionMetaUpdateCommand,
	type SessionPrLinkMode,
	type SessionPrNumber,
} from "@acepe/contracts";

export const prLinkToggleCommand = (input: {
	readonly commandId: CommandId;
	readonly sessionId: SessionId;
	readonly prNumber: SessionPrNumber | null;
	readonly prLinkMode: SessionPrLinkMode;
}): SessionMetaUpdateCommand =>
	SessionMetaUpdateCommand.make({
		type: "session.meta.update",
		commandId: input.commandId,
		sessionId: input.sessionId,
		prNumber: input.prNumber,
		prLinkMode: input.prLinkMode,
	});

export const shouldDispatchPrLinkToggle = (input: {
	readonly snapshot: RpcSessionSnapshot;
	readonly prLinkMode: SessionPrLinkMode;
}): boolean => {
	if (input.prLinkMode !== "automatic") {
		return true;
	}
	const session = input.snapshot.session;
	if (session === null) {
		return true;
	}
	return session.prLinkMode !== "manual";
};
