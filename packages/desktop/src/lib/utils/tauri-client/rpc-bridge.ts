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

const UNSUPPORTED_ON_CONTRACT_SUFFIX = "is not on the orchestration contract";

export const unsupportedOnContract = (operation: string): Effect.Effect<never, AgentError> =>
	Effect.fail(
		new AgentError(operation, new Error(`${operation} ${UNSUPPORTED_ON_CONTRACT_SUFFIX}`))
	);

/**
 * True when `error` is the failure produced by `unsupportedOnContract` --
 * i.e. the operation is a known stub with no server-side implementation yet,
 * not a real runtime failure. Callers that have an optional/best-effort path
 * (e.g. auto-importing skills on first run) can use this to degrade quietly
 * instead of surfacing an error to the user.
 */
export const isUnsupportedOnContract = (error: unknown): boolean =>
	error instanceof AgentError &&
	error.cause instanceof Error &&
	error.cause.message.endsWith(UNSUPPORTED_ON_CONTRACT_SUFFIX);

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
