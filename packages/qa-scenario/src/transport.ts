/**
 * A scenario replayed as the app's own RpcClient.
 *
 * This is the level-2 rig: real Svelte stores, real envelope reducer, real
 * streaming timing, no server and no agent. The app cannot tell the difference,
 * because it talks to the same `RpcTransport` contract it always does.
 *
 * Side-channel calls (git, agent, file index) answer from the recording. A call
 * the scenario never recorded fails loudly and is listed in `missingCalls`,
 * because a fake that quietly invents a git status turns QA into fiction.
 */

import {
	type AgentCallRequest,
	type GetProviderAccountUsageRequest,
	type GitCallRequest,
	type ImportProviderSessionRequest,
	type OrchestrationCommand,
	type ReadTextFileRequest,
	type RpcClient,
	type RpcSessionSnapshot,
	type SnapshotRequest,
	type TrimmedNonEmptyString,
	type WriteTextFileRequest,
	AgentCallResult,
	DiscoveredProviderProject,
	DiscoveredProviderSession,
	emptyRpcSessionSnapshot,
	GetProviderAccountUsageResponse,
	GitCallResult,
	ImportProviderSessionResult,
	makeResumingRpcClient,
	ProjectIndex,
	RpcTransportError,
} from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import type { ScenarioPlayer } from "./player.ts"
import type { QaScenario } from "./scenario.ts"
import { callKey, snapshotRequestKey } from "./scenario.ts"

export type ScenarioTransportRecord = {
	/** Every command the app wrote, in order. The QA assertion surface for writes. */
	readonly dispatched: ReadonlyArray<OrchestrationCommand>
	/** "method requestKey" for each side-channel call the app made, including repeats. */
	readonly observedCalls: ReadonlyArray<string>
	/**
	 * The distinct calls the scenario has no recording for. Distinct because the
	 * app retries a failed call: what a reader wants is which calls are missing,
	 * not how many times each one was tried. Feed these into a re-capture.
	 */
	readonly missingCalls: ReadonlyArray<string>
}

export type ScenarioTransport = {
	readonly client: RpcClient
	readonly record: Effect.Effect<ScenarioTransportRecord>
}

const describeCall = (method: string, key: string): string => `${method} ${key}`

type JsonDecoder<A> = (value: Schema.Json) => Effect.Effect<A, { readonly message: string }>

export const makeScenarioTransport = Effect.fn("makeScenarioTransport")(function* (
	scenario: QaScenario,
	player: ScenarioPlayer,
) {
	const log = {
		dispatched: [] as ReadonlyArray<OrchestrationCommand>,
		observed: [] as ReadonlyArray<string>,
		missing: [] as ReadonlyArray<string>,
	}

	const snapshotsByKey = new Map<string, RpcSessionSnapshot>()
	for (const line of scenario.snapshots) {
		snapshotsByKey.set(line.scopeKey, line.snapshot)
	}

	const callsByKey = new Map<string, Schema.Json>()
	for (const line of scenario.calls) {
		callsByKey.set(describeCall(line.method, line.requestKey), line.response)
	}

	const note = (method: string, key: string): void => {
		log.observed = Arr.append(log.observed, describeCall(method, key))
	}

	const recorded = <A>(method: string, key: string, decode: JsonDecoder<A>) =>
		Effect.suspend(() => {
			const label = describeCall(method, key)
			note(method, key)
			const found = callsByKey.get(label)
			if (found === undefined) {
				if (Arr.contains(log.missing, label) === false) {
					log.missing = Arr.append(log.missing, label)
				}
				return Effect.fail(
					new RpcTransportError({
						reason: `scenario '${scenario.meta.name}' has no recorded response for ${label}`,
					}),
				)
			}
			return decode(found).pipe(
				Effect.mapError(
					(error) =>
						new RpcTransportError({
							reason: `recorded response for ${label} does not match the contract: ${error.message}`,
						}),
				),
			)
		})

	const dispatch = (command: OrchestrationCommand) =>
		Effect.gen(function* () {
			log.dispatched = Arr.append(log.dispatched, command)
			const state = yield* player.state
			return { sequence: state.lastSequence }
		})

	const snapshot = (request: SnapshotRequest) =>
		Effect.gen(function* () {
			const key = snapshotRequestKey(request)
			note("snapshot", key)
			const found = snapshotsByKey.get(key)
			if (found !== undefined) {
				return found
			}
			const state = yield* player.state
			return emptyRpcSessionSnapshot(state.lastSequence)
		})

	const decodeText: JsonDecoder<string> = Schema.decodeUnknownEffect(Schema.String)

	const transport = {
		dispatch,
		snapshot,
		events: player.events,
		getProjectIndex: (projectPath: TrimmedNonEmptyString) =>
			recorded(
				"getProjectIndex",
				callKey(projectPath),
				Schema.decodeUnknownEffect(ProjectIndex),
			),
		invalidateProjectIndex: (projectPath: TrimmedNonEmptyString) =>
			Effect.sync(() => {
				note("invalidateProjectIndex", callKey(projectPath))
			}),
		readTextFile: (request: ReadTextFileRequest) =>
			recorded("readTextFile", callKey(request), decodeText),
		writeTextFile: (request: WriteTextFileRequest) =>
			Effect.sync(() => {
				note("writeTextFile", callKey(request))
			}),
		getDefaultShell: () => recorded("getDefaultShell", "", decodeText),
		gitCall: (request: GitCallRequest) =>
			recorded("gitCall", callKey(request), Schema.decodeUnknownEffect(GitCallResult)),
		agentCall: (request: AgentCallRequest) =>
			recorded("agentCall", callKey(request), Schema.decodeUnknownEffect(AgentCallResult)),
		getProviderAccountUsage: (request: GetProviderAccountUsageRequest) =>
			recorded(
				"getProviderAccountUsage",
				callKey(request),
				Schema.decodeUnknownEffect(GetProviderAccountUsageResponse),
			),
		listProviderSessions: (projectPath: TrimmedNonEmptyString) =>
			recorded(
				"listProviderSessions",
				callKey(projectPath),
				Schema.decodeUnknownEffect(Schema.Array(DiscoveredProviderSession)),
			),
		listProviderProjects: () =>
			recorded(
				"listProviderProjects",
				"",
				Schema.decodeUnknownEffect(Schema.Array(DiscoveredProviderProject)),
			),
		importProviderSession: (request: ImportProviderSessionRequest) =>
			recorded(
				"importProviderSession",
				callKey(request),
				Schema.decodeUnknownEffect(ImportProviderSessionResult),
			),
	}

	return {
		client: makeResumingRpcClient(transport),
		record: Effect.sync(() => ({
			dispatched: log.dispatched,
			observedCalls: log.observed,
			missingCalls: log.missing,
		})),
	} satisfies ScenarioTransport
})
