/**
 * Plan 014 U1 — path-to-test map for the conversation-dispatcher seam.
 *
 * Maps each characterization case in `agent-panel-graph-materializer.test.ts`
 * to the dispatcher fast path it exercises. ScenePatch pin tests live in the
 * `conversation dispatcher ScenePatch pins` describe in that file.
 *
 * Dispatcher path order matches `conversation-dispatcher.ts`.
 */

export type ConversationDispatcherPath =
	| "reuse"
	| "activity-only"
	| "blocking-interaction-retarget"
	| "operation-patch"
	| "streaming-state-patch"
	| "transcript-array-patch"
	| "transcript-patch-and-append"
	| "transcript-patch"
	| "transcript-truncation"
	| "transcript-append"
	| "interaction-patch"
	| "full-rebuild"
	| "optimistic-overlay"
	| "scene-text-limits"
	| "is-streaming-derivation";

export type ScenePatchPinPath = Extract<
	ConversationDispatcherPath,
	| "reuse"
	| "activity-only"
	| "blocking-interaction-retarget"
	| "operation-patch"
	| "streaming-state-patch"
	| "transcript-array-patch"
	| "transcript-patch"
	| "transcript-patch-and-append"
	| "transcript-truncation"
	| "transcript-append"
	| "interaction-patch"
	| "full-rebuild"
>;

/** Mandated R4 invariant pins outside the 74-case materializer net. */
export const R4_INVARIANT_CROSS_REFS = {
	mergedAssistantRowIdJoin:
		"graph-scene-entry-index.test.ts — selects by row id when assistant merging shifts display indexes",
	missingDisplayRow:
		"graph-scene-entry-index.test.ts — matches first-class missing display rows by scene id without transcript fallback",
	degradedOperationRow:
		"agent-panel-graph-materializer.test.ts — renders committed missing-operation tool rows as explicit degraded presentation",
} as const;

export const CONVERSATION_DISPATCHER_PATH_MAP: Record<
	ConversationDispatcherPath,
	readonly string[]
> = {
	reuse: [
		"reuses conversation rows when only lifecycle changes",
	],
	"activity-only": [
		"reuses conversation rows when only graph activity changes",
		"keeps conversation rows stable when only the operations array identity changes",
		"keeps conversation rows stable when an operation patch has no visible scene change",
		"keeps conversation entries stable when interaction changes are not visible",
		"keeps invisible marked interaction appends incremental without scanning the next prefix",
	],
	"blocking-interaction-retarget": [
		"retargets the blocking interaction without scanning unchanged interactions",
		"retargets the blocking interaction across stable unmarked interaction appends without scanning the unchanged prefix",
	],
	"operation-patch": [
		"reuses unaffected conversation rows when one linked operation changes",
		"updates a transcript row when one child operation changes",
		"applies marked operation patches without scanning unchanged operations",
		"rematerializes interaction rows when operation patches change the blocking interaction",
		"applies marked operation appends without cloning existing operation indexes",
		"applies marked operation appends without filtering appended parent lists on lookup",
		"applies stable marked operation patches and appends without cloning indexes",
		"applies stable unmarked operation patches and appends without cloning indexes",
		"applies marked operation patches without copying unaffected parent lists",
		"keeps live transcript-before-operation races pending until canonical operation data arrives",
	],
	"streaming-state-patch": [
		"patches only affected assistant rows when the active streaming tail moves",
		"keeps transcript row patches incremental when equivalent control objects are recreated",
	],
	"transcript-array-patch": [
		"applies marked transcript appends without scanning unchanged transcript rows",
	],
	"transcript-patch-and-append": [
		"applies marked transcript patch-plus-append deltas without scanning unchanged transcript rows",
		"applies stable transcript patch-plus-append updates without rematerializing the preserved prefix",
	],
	"transcript-patch": [
		"patches one transcript row without rebuilding unaffected conversation rows",
	],
	"transcript-truncation": [
		"applies stable transcript truncation without rematerializing preserved rows",
	],
	"transcript-append": [
		"appends transcript rows without rebuilding existing conversation rows",
		"patches row indexes when appending transcript rows before pending interactions",
	],
	"interaction-patch": [
		"patches visible interaction rows without rematerializing transcript rows",
		"patches same-length visible interaction updates without rebuilding transcript rows",
		"applies marked interaction appends without scanning unchanged interactions",
		"applies stable interaction appends without scanning unchanged interactions",
		"applies marked interaction removals without scanning unchanged interactions",
		"applies stable interaction removals without scanning unchanged interactions",
	],
	"full-rebuild": [
		"reuses the operation index when materializing a fresh cached conversation",
		"projects canonical transcript timestamps directly into message scene entries",
		"renders only the blocking pending question interaction when duplicate question records exist",
		"keeps question display identity separate from semantic interaction identity",
		"materializes rich tool entries from canonical operations instead of transcript placeholders",
		"keeps transcript display identity when canonical operation tool id differs",
		"requires transcript source links even when tool call ids match",
		"preserves editDiffs through scene text limit filtering for edit tool calls",
		"preserves lifecycle actionability and resume actions in the scene contract",
		"surfaces canonical turn failures as error status before lifecycle catches up",
		"concatenates assistant transcript token segments without markdown line breaks",
		"preserves canonical thought segments as assistant thought chunks",
		"does not join transcript rows through coincidental operation ids",
		"does not join transcript rows through matching tool call ids without a source link",
		"uses canonical operation state instead of provider status for presentation",
		"renders valid unclassified operations without degraded warning styling",
		"renders blocked from canonical operation state even when provider status is stale",
		"keeps unresolved tool diagnostics free of full transcript text",
		"recursively materializes task children from canonical child operations",
		"bounds display output before values enter scene DTOs",
		"renders committed missing-operation tool rows as explicit degraded presentation",
	],
	"optimistic-overlay": [
		"appends the optimistic entry as the last entry with isOptimistic: true when graph is present",
		"inserts the optimistic entry before tool calls when no canonical user has landed",
		"keeps optimistic entry after prior-turn tool calls when canonical user history exists",
		"graph + no optimistic → output identical to today (regression guard)",
		"graph === null + optimistic entry → single-entry scene with isOptimistic: true, warming status",
		"graph === null + no optimistic → empty conversation, warming status, no crash",
		"empty graph (non-null, no entries) + optimistic → single-entry scene with isOptimistic: true",
		"both canonical and optimistic entries appear when they have independent UUIDs",
		"surfaces only the canonical user entry once matching attemptId has landed",
		"rejects transient live assistant overlay while canonical transcript is still on the user turn",
	],
	"scene-text-limits": [
		"applySceneTextLimits passes through every populated AgentToolEntry field unchanged except the declared truncation targets",
		"applySceneTextLimits preserves empty arrays as empty arrays (does not nullify)",
	],
	"is-streaming-derivation": [
		"marks only the canonical active streaming tail as isStreaming when turnState is Running",
		"does not infer streaming from transcript position when canonical active streaming tail is absent",
		"marks no assistant entry as isStreaming when turnState is Completed",
		"does not let stale live assistant text hide a completed canonical answer",
		"does not restart streaming reveal for the previous assistant while waiting for the next response",
		"marks the canonical active tail as isStreaming even when tool entries follow it",
		"does not mark completed assistant text as streaming while a trailing tool is active",
		"keeps the open assistant streaming after a completed trailing tool while awaiting model text",
	],
};

/** All 74 characterization cases — must match `agent-panel-graph-materializer.test.ts` exactly once. */
export const MATERIALIZER_CHARACTERIZATION_TEST_TITLES: readonly string[] = Object.values(
	CONVERSATION_DISPATCHER_PATH_MAP
).flat();

export const SCENE_PATCH_PIN_TEST_TITLES: readonly string[] = [
	"full rebuild selects ScenePatch kind fullRebuild on first materialization",
	"reuse preserves the prior ScenePatch when only non-entry graph fields change",
	"activity-only update preserves ScenePatch when conversation entries are unchanged",
	"operation patch selects ScenePatch kind graphScene for a visible tool row change",
	"operation patch with no visible scene change preserves the prior ScenePatch",
	"streaming-state patch selects ScenePatch kind graphScene when the active tail stops streaming",
	"transcript array patch selects ScenePatch kind graphScene for a marked row update",
	"transcript patch selects ScenePatch kind graphScene for a single row text change",
	"transcript patch-and-append selects ScenePatch kind graphSceneSplice",
	"transcript truncation without trailing interactions selects ScenePatch kind graphSceneTruncation",
	"transcript append selects ScenePatch kind graphSceneAppend",
	"interaction visible append selects ScenePatch kind graphSceneAppend",
	"blocking interaction retarget selects ScenePatch kind graphSceneSplice",
];
