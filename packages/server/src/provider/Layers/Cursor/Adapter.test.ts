import {
	type ApprovalRequestedEvent,
	type OrchestrationEvent,
	MessageId,
	ProjectId,
	SessionId,
	tracerAssistantMessageId
} from "@acepe/contracts"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Arr from "effect/Array"
import type { Done } from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import * as Stream from "effect/Stream"
import * as Str from "effect/String"
import type { Json } from "../Json.ts"
import {
	CURSOR_ACP_PROTOCOL_VERSION,
	CURSOR_ACP_SDK_MODULE,
	makeCursorAdapter
} from "./Adapter.ts"
import { decodeContractFact } from "./Codec.ts"
import type {
	CursorAcpHandle,
	CursorConnectInput,
	CursorLaunchConfig
} from "./Process.ts"
import { cursorPresence } from "./Provider.ts"

const FORBIDDEN_ACP_ENTRY = "experimental/v2"
const STABLE_ACP_ENTRY = "@agentclientprotocol/sdk"
const STABLE_ACP_TRANSPORT = "ndJsonStream"

const sessionId = SessionId.make("session-1")
const projectId = ProjectId.make("project-1")
const messageId = MessageId.make("message-user")
const registryLaunch: CursorLaunchConfig = {
	command: "/cache/cursor/dist-package/cursor-agent",
	args: ["acp"]
}

const Platform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer)

const folderSources = Effect.gen(function*() {
	const path = yield* Path.Path
	const fs = yield* FileSystem.FileSystem
	const here = yield* path.fromFileUrl(new URL(import.meta.url))
	const folder = path.dirname(here)
	const guard = path.basename(here)
	const names = yield* fs.readDirectory(folder)
	const scanned = Arr.filter(names, (name) => Str.endsWith(".ts")(name) && name !== guard)
	return yield* Effect.forEach(scanned, (name) =>
		fs.readFileString(path.join(folder, name)).pipe(Effect.map((source) => ({ name, source })))
	)
})

const fakeHandle = (
	inbound: Queue.Queue<Json, Done>,
	cancels: Ref.Ref<number>,
	cwds: Ref.Ref<ReadonlyArray<string>>
): CursorAcpHandle => ({
	initialize: Effect.void,
	newSession: (cwd: string) =>
		Ref.update(cwds, (current) => Arr.append(current, cwd)).pipe(
			Effect.as("acp-session-1")
		),
	prompt: () => Effect.succeed(Option.none()),
	cancel: () => Ref.update(cancels, (count) => count + 1).pipe(Effect.asVoid),
	close: Queue.end(inbound).pipe(Effect.asVoid)
})

const acpPermissionRequest = (toolCallId: string): Json => ({
	sessionId: "acp-session-1",
	toolCall: {
		toolCallId,
		title: "Run tests",
		kind: "execute",
		status: "pending"
	},
	options: [
		{ optionId: "allow-once", name: "Allow once", kind: "allow_once" },
		{ optionId: "reject", name: "Reject", kind: "reject_once" }
	]
})

// Fails loudly if a permission request folds into the generic
// SessionMetaUpdated branch instead of the typed approval event.
const nextApprovalRequested = Effect.fn("nextApprovalRequested")(function*(
	events: Queue.Queue<OrchestrationEvent, Done>
) {
	let found: ApprovalRequestedEvent | undefined
	for (let attempt = 0; attempt < 5 && found === undefined; attempt++) {
		const next = yield* Queue.take(events)
		if (next.type === "SessionMetaUpdated") {
			const fact = decodeContractFact(next.metadata)
			if (Option.isSome(fact)) {
				Vitest.assert.notStrictEqual(fact.value.contractKind, "permission_request")
			}
		}
		if (next.type === "ApprovalRequested") {
			found = next
		}
	}
	return found
})

const fakeConnect = (
	inbound: Queue.Queue<Json, Done>,
	launches: Ref.Ref<Option.Option<CursorLaunchConfig>>,
	cancels: Ref.Ref<number>,
	cwds: Ref.Ref<ReadonlyArray<string>>
) =>
	(input: CursorConnectInput) =>
		Effect.gen(function*() {
			yield* Ref.set(launches, Option.some(input.launch))
			yield* Stream.fromQueue(inbound).pipe(
				Stream.runForEach(input.onSessionUpdate),
				Effect.forkChild({ startImmediately: true })
			)
			return fakeHandle(inbound, cancels, cwds)
		})

Vitest.describe("Cursor ACP SDK pin", () => {
	Vitest.it("uses ACP protocol version 1 from the stable SDK entry", () => {
		Vitest.assert.strictEqual(CURSOR_ACP_SDK_MODULE, "@agentclientprotocol/sdk")
		Vitest.assert.strictEqual(CURSOR_ACP_PROTOCOL_VERSION, 1)
	})
})

Vitest.describe("CursorAdapter", () => {
	Vitest.it.effect("starts a session with launch config from cursor/agent.json", () =>
		Effect.gen(function*() {
			const inbound = yield* Queue.unbounded<Json, Done>()
			const launches = yield* Ref.make(Option.none<CursorLaunchConfig>())
			const cancels = yield* Ref.make(0)
			const cwds = yield* Ref.make<ReadonlyArray<string>>(Arr.empty())
			const adapter = yield* makeCursorAdapter({
				presence: Effect.succeed(cursorPresence(true, true)),
				resolveLaunch: Effect.succeed(registryLaunch),
				connect: fakeConnect(inbound, launches, cancels, cwds)
			})
			const events = yield* Queue.unbounded<OrchestrationEvent, Done>()
			yield* adapter
				.startSession({
					sessionId,
					projectId,
					workspaceRoot: "/tmp/acepe"
				})
				.pipe(
					Stream.runForEach((event) => Queue.offer(events, event).pipe(Effect.asVoid)),
					Effect.forkChild({ startImmediately: true })
				)
			const opened = yield* Queue.take(events)
			Vitest.assert.strictEqual(opened.type, "SessionMetaUpdated")
			const fact = decodeContractFact(opened.metadata)
			Vitest.assert.isTrue(Option.isSome(fact))
			if (Option.isSome(fact) && fact.value.contractKind === "provider_session") {
				Vitest.assert.strictEqual(fact.value.providerSessionId, "acp-session-1")
			}
			const launch = yield* Ref.get(launches)
			Vitest.assert.deepStrictEqual(launch, Option.some(registryLaunch))
			Vitest.assert.deepStrictEqual(yield* Ref.get(cwds), ["/tmp/acepe"])
			yield* adapter.cancelTurn({ sessionId })
		})
	)

	Vitest.it.effect("streams TokenAppended from ACP agent_message_chunk updates", () =>
		Effect.gen(function*() {
			const inbound = yield* Queue.unbounded<Json, Done>()
			const launches = yield* Ref.make(Option.none<CursorLaunchConfig>())
			const cancels = yield* Ref.make(0)
			const cwds = yield* Ref.make<ReadonlyArray<string>>(Arr.empty())
			const adapter = yield* makeCursorAdapter({
				presence: Effect.succeed(cursorPresence(true, true)),
				resolveLaunch: Effect.succeed(registryLaunch),
				connect: fakeConnect(inbound, launches, cancels, cwds)
			})
			const events = yield* Queue.unbounded<OrchestrationEvent, Done>()
			yield* adapter
				.startSession({
					sessionId,
					projectId,
					workspaceRoot: "/tmp/acepe"
				})
				.pipe(
					Stream.runForEach((event) => Queue.offer(events, event).pipe(Effect.asVoid)),
					Effect.forkChild({ startImmediately: true })
				)
			yield* Queue.take(events)
			yield* Stream.runCollect(
				adapter.sendPrompt({
					sessionId,
					messageId,
					text: "Hi"
				})
			)
			yield* Queue.offer(inbound, {
				sessionId: "acp-session-1",
				update: {
					sessionUpdate: "agent_message_chunk",
					content: {
						type: "text",
						text: "Hello"
					}
				}
			})
			const first = yield* Queue.take(events)
			const tokenEvent = first.type === "TokenAppended" ? first : yield* Queue.take(events)
			Vitest.assert.strictEqual(tokenEvent.type, "TokenAppended")
			if (tokenEvent.type === "TokenAppended") {
				Vitest.assert.strictEqual(tokenEvent.payload.token, "Hello")
				Vitest.assert.strictEqual(
					tokenEvent.payload.messageId,
					tracerAssistantMessageId(messageId)
				)
			}
			yield* adapter.cancelTurn({ sessionId })
		})
	)

	// An ACP session/request_permission used to fold into the generic
	// makeMetaEvent/SessionMetaUpdated branch, whose metadata nobody reads for
	// approvals: ProjectionPendingApprovals.apply only reacts to a native
	// ApprovalRequested/InteractionReplied event or an explicitly stamped
	// pendingApproval metadata key. The desktop therefore had no approval row
	// to render, no InteractionReplied ever came back, and the ACP request the
	// agent was blocked on stayed pending for the rest of the turn. Same
	// carve-out ClaudeAdapter took for #268 defect 2.
	Vitest.it.effect("emits one answerable ApprovalRequested per ACP permission request", () =>
		Effect.gen(function*() {
			const inbound = yield* Queue.unbounded<Json, Done>()
			const cancels = yield* Ref.make(0)
			const cwds = yield* Ref.make<ReadonlyArray<string>>(Arr.empty())
			const asked = yield* Ref.make(Option.none<CursorConnectInput["onPermissionRequest"]>())
			const adapter = yield* makeCursorAdapter({
				presence: Effect.succeed(cursorPresence(true, true)),
				resolveLaunch: Effect.succeed(registryLaunch),
				connect: (input: CursorConnectInput) =>
					Ref.set(asked, Option.some(input.onPermissionRequest)).pipe(
						Effect.as(fakeHandle(inbound, cancels, cwds))
					)
			})
			const events = yield* Queue.unbounded<OrchestrationEvent, Done>()
			yield* adapter
				.startSession({
					sessionId,
					projectId,
					workspaceRoot: "/tmp/acepe"
				})
				.pipe(
					Stream.runForEach((event) => Queue.offer(events, event).pipe(Effect.asVoid)),
					Effect.forkChild({ startImmediately: true })
				)
			yield* Queue.take(events)
			const handler = yield* Ref.get(asked)
			if (Option.isNone(handler)) {
				Vitest.assert.fail("expected connect to receive an onPermissionRequest handler")
				return
			}
			const decisionFiber = yield* handler
				.value(acpPermissionRequest("call_9"))
				.pipe(Effect.forkChild({ startImmediately: true }))
			const requested = yield* nextApprovalRequested(events)
			if (requested === undefined) {
				Vitest.assert.fail("expected an ApprovalRequested event for the ACP permission request")
				return
			}
			Vitest.assert.strictEqual(requested.payload.sessionId, sessionId)
			Vitest.assert.strictEqual(requested.payload.approvalRequestId, "perm-call_9")
			Vitest.assert.strictEqual(requested.payload.title, "execute")
			yield* adapter.respondToPermission({
				sessionId,
				permissionId: requested.payload.approvalRequestId,
				decision: "allow"
			})
			Vitest.assert.strictEqual(yield* Fiber.join(decisionFiber), "allow")
			yield* adapter.cancelTurn({ sessionId })
		})
	)

	// ACP hands the client no id of its own for session/request_permission, so
	// the approval id is derived from the tool call. A tool call that asks
	// twice — a second permission scope, or a retry after a rejection — used
	// to produce two approvals under one id: the second deferred evicted the
	// first from pendingPermissions, the single answer released the second,
	// and the first ACP request stayed pending for the rest of the turn.
	Vitest.it.effect("answers both permission requests raised by one tool call", () =>
		Effect.gen(function*() {
			const inbound = yield* Queue.unbounded<Json, Done>()
			const cancels = yield* Ref.make(0)
			const cwds = yield* Ref.make<ReadonlyArray<string>>(Arr.empty())
			const asked = yield* Ref.make(Option.none<CursorConnectInput["onPermissionRequest"]>())
			const adapter = yield* makeCursorAdapter({
				presence: Effect.succeed(cursorPresence(true, true)),
				resolveLaunch: Effect.succeed(registryLaunch),
				connect: (input: CursorConnectInput) =>
					Ref.set(asked, Option.some(input.onPermissionRequest)).pipe(
						Effect.as(fakeHandle(inbound, cancels, cwds))
					)
			})
			const events = yield* Queue.unbounded<OrchestrationEvent, Done>()
			yield* adapter
				.startSession({
					sessionId,
					projectId,
					workspaceRoot: "/tmp/acepe"
				})
				.pipe(
					Stream.runForEach((event) => Queue.offer(events, event).pipe(Effect.asVoid)),
					Effect.forkChild({ startImmediately: true })
				)
			yield* Queue.take(events)
			const handler = yield* Ref.get(asked)
			if (Option.isNone(handler)) {
				Vitest.assert.fail("expected connect to receive an onPermissionRequest handler")
				return
			}
			const firstFiber = yield* handler
				.value(acpPermissionRequest("call_9"))
				.pipe(Effect.forkChild({ startImmediately: true }))
			const first = yield* nextApprovalRequested(events)
			const secondFiber = yield* handler
				.value(acpPermissionRequest("call_9"))
				.pipe(Effect.forkChild({ startImmediately: true }))
			const second = yield* nextApprovalRequested(events)
			if (first === undefined || second === undefined) {
				Vitest.assert.fail("expected an ApprovalRequested event for each ACP permission request")
				return
			}
			Vitest.assert.strictEqual(first.payload.approvalRequestId, "perm-call_9")
			Vitest.assert.notStrictEqual(
				second.payload.approvalRequestId,
				first.payload.approvalRequestId
			)
			yield* adapter.respondToPermission({
				sessionId,
				permissionId: first.payload.approvalRequestId,
				decision: "allow"
			})
			yield* adapter.respondToPermission({
				sessionId,
				permissionId: second.payload.approvalRequestId,
				decision: "deny"
			})
			Vitest.assert.strictEqual(yield* Fiber.join(firstFiber), "allow")
			Vitest.assert.strictEqual(yield* Fiber.join(secondFiber), "deny")
			yield* adapter.cancelTurn({ sessionId })
		})
	)

	Vitest.it.effect("cancelTurn notifies the ACP session and emits TurnCancelled", () =>
		Effect.gen(function*() {
			const inbound = yield* Queue.unbounded<Json, Done>()
			const launches = yield* Ref.make(Option.none<CursorLaunchConfig>())
			const cancels = yield* Ref.make(0)
			const cwds = yield* Ref.make<ReadonlyArray<string>>(Arr.empty())
			const adapter = yield* makeCursorAdapter({
				presence: Effect.succeed(cursorPresence(true, true)),
				resolveLaunch: Effect.succeed(registryLaunch),
				connect: fakeConnect(inbound, launches, cancels, cwds)
			})
			const events = yield* Queue.unbounded<OrchestrationEvent, Done>()
			yield* adapter
				.startSession({
					sessionId,
					projectId,
					workspaceRoot: "/tmp/acepe"
				})
				.pipe(
					Stream.runForEach((event) => Queue.offer(events, event).pipe(Effect.asVoid)),
					Effect.forkChild({ startImmediately: true })
				)
			yield* Queue.take(events)
			yield* adapter.cancelTurn({ sessionId })
			const cancelled = yield* Queue.take(events)
			Vitest.assert.strictEqual(cancelled.type, "TurnCancelled")
			Vitest.assert.strictEqual(yield* Ref.get(cancels), 1)
		})
	)
})

Vitest.layer(Platform)("Cursor folder source and fixtures", (it) => {
	it.effect("keeps every file in the folder off the experimental ACP entry", () =>
		Effect.gen(function*() {
			const scanned = yield* folderSources
			Vitest.assert.isTrue(Arr.isReadonlyArrayNonEmpty(scanned))
			const offenders = Arr.map(
				Arr.filter(scanned, (entry) => Str.includes(FORBIDDEN_ACP_ENTRY)(entry.source)),
				(entry) => entry.name
			)
			Vitest.assert.deepStrictEqual(offenders, [])
		})
	)

	it.effect("keeps one file in the folder on the stable ACP SDK transport", () =>
		Effect.gen(function*() {
			const scanned = yield* folderSources
			const transports = Arr.map(
				Arr.filter(
					scanned,
					(entry) =>
						Str.includes(STABLE_ACP_ENTRY)(entry.source) &&
						Str.includes(STABLE_ACP_TRANSPORT)(entry.source)
				),
				(entry) => entry.name
			)
			Vitest.assert.isTrue(Arr.isReadonlyArrayNonEmpty(transports))
		})
	)

	it.effect("finds no recorded Cursor fixture under packages/harness/fixtures", () =>
		Effect.gen(function*() {
			const path = yield* Path.Path
			const fs = yield* FileSystem.FileSystem
			// Resolved through the package, so moving this test between folders cannot break it.
			const harnessEntry = yield* path.fromFileUrl(new URL(import.meta.resolve("@acepe/harness")))
			const fixturesDir = path.join(path.dirname(path.dirname(harnessEntry)), "fixtures")
			const names = yield* fs.readDirectory(fixturesDir)
			const cursorNames = Arr.filter(names, (name) => Str.includes("cursor")(Str.toLowerCase(name)))
			Vitest.assert.deepStrictEqual(cursorNames, [])
		})
	)
})
