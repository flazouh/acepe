import { describe, expect, it } from "bun:test";
import {
	CommandId,
	MessageId,
	MessageSendCommand,
	type OrchestrationCommand,
	type RpcClient,
	SessionId,
} from "@acepe/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { setAppRpcClientForTest } from "../../rpc/app-client.ts";
import { composerSendCommand, sendComposerMessage } from "./agent-panel-send.ts";

const sessionId = SessionId.make("library-session-artifacts");
const commandId = CommandId.make("cmd-send");
const messageId = MessageId.make("msg-send");

const unusedClient = (): RpcClient => ({
	dispatch: () => Effect.succeed({ sequence: 1 }),
	snapshot: () => Effect.die("unused"),
	getProjectIndex: () => Effect.die("unused"),
	invalidateProjectIndex: () => Effect.void,
	events: () => Stream.empty,
});

describe("composerSendCommand", () => {
	it("builds message.send from trimmed composer text", () => {
		expect(
			composerSendCommand({
				sessionId,
				text: "  hello from qa  ",
				commandId,
				messageId,
			}),
		).toEqual(
			MessageSendCommand.make({
				type: "message.send",
				commandId,
				sessionId,
				messageId,
				text: "hello from qa",
			}),
		);
	});

	it("returns null for blank composer text", () => {
		expect(
			composerSendCommand({
				sessionId,
				text: "   ",
				commandId,
				messageId,
			}),
		).toBeNull();
	});
});

describe("sendComposerMessage", () => {
	it("dispatches message.send through appRpcClient", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const dispatched: Array<OrchestrationCommand> = [];
				const client = unusedClient();
				setAppRpcClientForTest({
					dispatch: (command) => {
						dispatched.push(command);
						return Effect.succeed({ sequence: 9 });
					},
					snapshot: client.snapshot,
					getProjectIndex: client.getProjectIndex,
					invalidateProjectIndex: client.invalidateProjectIndex,
					events: client.events,
				});
				yield* sendComposerMessage({
					sessionId,
					text: "hello from qa",
					commandId,
					messageId,
				});
				expect(dispatched).toEqual([
					MessageSendCommand.make({
						type: "message.send",
						commandId,
						sessionId,
						messageId,
						text: "hello from qa",
					}),
				]);
				setAppRpcClientForTest(null);
			}),
		));

	it("does not dispatch blank composer text", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const dispatched: Array<OrchestrationCommand> = [];
				const client = unusedClient();
				setAppRpcClientForTest({
					dispatch: (command) => {
						dispatched.push(command);
						return Effect.succeed({ sequence: 9 });
					},
					snapshot: client.snapshot,
					getProjectIndex: client.getProjectIndex,
					invalidateProjectIndex: client.invalidateProjectIndex,
					events: client.events,
				});
				yield* sendComposerMessage({
					sessionId,
					text: " ",
					commandId,
					messageId,
				});
				expect(dispatched).toEqual([]);
				setAppRpcClientForTest(null);
			}),
		));
});
