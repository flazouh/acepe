import {
	CommandId,
	type RpcClient,
	type RpcClientError,
	TrimmedNonEmptyString,
} from "@acepe/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { AgentError } from "../../acp/errors/app-error.js";
import { appRpcClient } from "../../rpc/app-client.ts";

let commandSeq = 0;

export const nextCommandId = Effect.fn("nextCommandId")(function* (prefix: string) {
	const now = yield* Clock.currentTimeMillis;
	commandSeq += 1;
	return CommandId.make(`${prefix}-${String(now)}-${String(commandSeq)}`);
});

export const toAgentError = (operation: string, error: RpcClientError): AgentError =>
	new AgentError(operation, error);

export const withRpcClient = <A>(
	operation: string,
	use: (client: RpcClient) => Effect.Effect<A, RpcClientError>
): Effect.Effect<A, AgentError> =>
	appRpcClient().pipe(
		Effect.flatMap(use),
		Effect.mapError((error) => toAgentError(operation, error))
	);

export const unsupportedOnContract = (operation: string): Effect.Effect<never, AgentError> =>
	Effect.fail(
		new AgentError(
			operation,
			new Error(`${operation} is not on the orchestration contract`)
		)
	);

export const decodeTrimmed = (
	operation: string,
	value: string
): Effect.Effect<typeof TrimmedNonEmptyString.Type, AgentError> =>
	Schema.decodeUnknownEffect(TrimmedNonEmptyString)(value).pipe(
		Effect.mapError(
			(error) => new AgentError(operation, new Error(error.message))
		)
	);

export const decodeEffect = <A>(
	operation: string,
	decode: (value: unknown) => Effect.Effect<A, { readonly message: string }>
): ((value: unknown) => Effect.Effect<A, AgentError>) =>
	(value) =>
		decode(value).pipe(
			Effect.mapError(
				(error) => new AgentError(operation, new Error(error.message))
			)
		);
