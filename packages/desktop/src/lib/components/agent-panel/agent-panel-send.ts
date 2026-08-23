import {
	type CommandId,
	type MessageId,
	MessageSendCommand,
	type SessionId,
} from "@acepe/contracts";
import * as Effect from "effect/Effect";

import { appRpcClient } from "../../rpc/app-client.ts";

export const composerSendCommand = (input: {
	readonly sessionId: SessionId;
	readonly text: string;
	readonly commandId: CommandId;
	readonly messageId: MessageId;
}): MessageSendCommand | null => {
	const text = input.text.trim();
	if (text.length === 0) {
		return null;
	}
	return MessageSendCommand.make({
		type: "message.send",
		commandId: input.commandId,
		sessionId: input.sessionId,
		messageId: input.messageId,
		text,
	});
};

export const sendComposerMessage = Effect.fn("sendComposerMessage")(function* (input: {
	readonly sessionId: SessionId;
	readonly text: string;
	readonly commandId: CommandId;
	readonly messageId: MessageId;
}) {
	const command = composerSendCommand(input);
	if (command === null) {
		return;
	}
	const client = yield* appRpcClient();
	return yield* client.dispatch(command);
});
