import { SvelteMap } from "svelte/reactivity";
import type {
SessionGraphRevision,
ViewportBufferDelta,
ViewportBufferPush,
VisibleTranscriptWindowPayload,
} from "../../services/acp-types.js";

export type ViewportAttachmentStatus = "attached" | "reattaching" | "reattachFailed";

/**
 * Which viewport wire protocol a session is locked to. The first accepted
 * payload wins until the session detaches/resets, so the legacy
 * `visibleWindow` path and the new `buffer` path can never both mutate the
 * same session's projection.
 */
type ViewportProtocol = "visibleWindow" | "buffer";

export type TranscriptViewportProjection = {
readonly sessionId: string;
readonly revision: SessionGraphRevision;
readonly viewportRevision: number;
readonly totalHeightPx: number;
readonly viewportOffsetPx: number;
readonly visibleStartIndex: number;
readonly visibleEndIndex: number;
readonly rows: VisibleTranscriptWindowPayload["rows"];
readonly rowOffsetsPx: VisibleTranscriptWindowPayload["rowOffsetsPx"];
readonly mode: VisibleTranscriptWindowPayload["mode"];
readonly diagnostics: VisibleTranscriptWindowPayload["diagnostics"];
};

/**
 * The WebView-side projection of a Rust `ViewportBufferPush`. `rows[i]` is the
 * canonical row at `bufferStartIndex + i`; `offsetsPx[i]` is that row's
 * absolute pixel top. `bufferEndOffsetPx` is the bottom of the last buffered
 * row, so the buffered pixel span is `[offsetsPx[0], bufferEndOffsetPx)`.
 */
export type BufferProjection = {
readonly sessionId: string;
readonly revision: SessionGraphRevision;
readonly viewportRevision: number;
/**
 * Per-session monotonic emission sequence — the total-order authority for the
 * buffer protocol. A push sets this baseline; a delta is applied only when it
 * chains contiguously (`delta.emissionSeq === emissionSeq + 1`). Unlike
 * `viewportRevision` (which does NOT advance on streaming row appends), this
 * uniquely orders payloads arriving on the two independent channels (command
 * replies vs the live event stream), so any reordering becomes a detectable
 * stale-drop or gap instead of silent buffer corruption.
 */
readonly emissionSeq: number;
readonly bufferStartIndex: number;
readonly bufferEndIndex: number;
readonly layoutRowCount: number;
readonly totalHeightPx: number;
readonly bufferEndOffsetPx: number;
readonly rows: ViewportBufferPush["rows"];
readonly offsetsPx: ViewportBufferPush["offsetsPx"];
readonly mode: ViewportBufferPush["mode"];
readonly scrollTopTarget: number | null;
readonly diagnostics: ViewportBufferPush["diagnostics"];
readonly lastGeneration: number | null;
};

/**
 * A locally-resolved visible slice of a buffer projection. Indices are
 * absolute (into the full canonical layout); `rows`/`offsetsPx` are the
 * matching sub-slices ready to render.
 */
export type ResolvedVisibleSlice = {
readonly startIndex: number;
readonly endIndex: number;
readonly rows: ViewportBufferPush["rows"];
readonly offsetsPx: ViewportBufferPush["offsetsPx"];
};

/**
 * Outcome of applying a `ViewportBufferDelta`.
 *
 * - `applied`: the delta chained cleanly; the projection advanced. Any
 *   `scrollAnchorCorrectionPx` / `scrollTopTarget` the controller must apply to
 *   the live scroll position is surfaced here (the store never owns scrollTop).
 * - `gap`: the delta could not chain — no base buffer, or its `emissionSeq`
 *   skipped ahead of the next expected sequence. The controller must request a
 *   fresh full `ViewportBufferPush`. The projection is left untouched.
 * - `stale`: the delta's `emissionSeq` is at or behind the current sequence (a
 *   duplicate or reordered older payload). Idempotent no-op; the controller
 *   does nothing. The projection is left untouched.
 * - `rejected`: the session is locked to the other wire protocol, or the
 *   session id is null. Nothing to do.
 */
export type BufferDeltaResult =
| {
readonly status: "applied";
readonly scrollAnchorCorrectionPx: number | null;
readonly scrollTopTarget: number | null;
}
| { readonly status: "gap" }
| { readonly status: "stale" }
| { readonly status: "rejected" };

function isNewerRevision(
current: { readonly revision: SessionGraphRevision; readonly viewportRevision: number } | null,
incoming: { readonly graphRevision: SessionGraphRevision; readonly viewportRevision: number }
): boolean {
if (current === null) {
return true;
}
if (incoming.graphRevision.graphRevision > current.revision.graphRevision) {
return true;
}
if (incoming.graphRevision.graphRevision < current.revision.graphRevision) {
return false;
}
return incoming.viewportRevision > current.viewportRevision;
}

function projectionFromWindow(window: VisibleTranscriptWindowPayload): TranscriptViewportProjection {
return {
sessionId: window.sessionId,
revision: window.graphRevision,
viewportRevision: window.viewportRevision,
totalHeightPx: window.totalHeightPx,
viewportOffsetPx: window.viewportOffsetPx,
visibleStartIndex: window.visibleStartIndex,
visibleEndIndex: window.visibleEndIndex,
rows: window.rows,
rowOffsetsPx: window.rowOffsetsPx,
mode: window.mode,
diagnostics: window.diagnostics,
};
}

function projectionFromPush(push: ViewportBufferPush): BufferProjection {
return {
sessionId: push.sessionId,
revision: push.graphRevision,
viewportRevision: push.viewportRevision,
emissionSeq: push.emissionSeq,
bufferStartIndex: push.bufferStartIndex,
bufferEndIndex: push.bufferEndIndex,
layoutRowCount: push.layoutRowCount,
totalHeightPx: push.totalHeightPx,
bufferEndOffsetPx: push.bufferEndOffsetPx,
rows: push.rows,
offsetsPx: push.offsetsPx,
mode: push.mode,
scrollTopTarget: push.scrollTopTarget ?? null,
diagnostics: push.diagnostics,
lastGeneration: push.requestGeneration ?? null,
};
}

/**
 * Apply a chained delta to an existing buffer projection, producing the next
 * projection. Assumes the caller already verified the sequence chain
 * (`delta.emissionSeq === current.emissionSeq + 1`).
 *
 * Row model: removed rows are dropped by `rowId`; survivors keep their
 * absolute offsets (valid because a slide only changes layout at the edges).
 * The new buffer is `prepended ++ surviving ++ appended`. Because removals are
 * a contiguous block at the top (scroll down) or bottom (scroll up), the new
 * absolute `bufferStartIndex` is derived from how many leading rows were
 * dropped and how many were prepended — no per-row index is carried on the
 * wire. `mode` is preserved (the delta wire carries no mode; a mode change
 * arrives as a fresh push).
 */
function projectionFromDelta(
current: BufferProjection,
delta: ViewportBufferDelta
): BufferProjection {
const removed = new Set(delta.removedRowIds);

let firstSurvivingLocalIndex = current.rows.length;
for (let i = 0; i < current.rows.length; i++) {
if (!removed.has(current.rows[i].rowId)) {
firstSurvivingLocalIndex = i;
break;
}
}

const survivingRows = current.rows.filter((row) => !removed.has(row.rowId));
const survivingOffsets = current.offsetsPx.filter(
(_, i) => !removed.has(current.rows[i].rowId)
);

const nextRows = delta.prependedRows.concat(survivingRows, delta.appendedRows);
const nextOffsets = delta.prependedOffsetsPx.concat(
survivingOffsets,
delta.appendedOffsetsPx
);

const nextBufferStartIndex =
current.bufferStartIndex + firstSurvivingLocalIndex - delta.prependedRows.length;

return {
sessionId: current.sessionId,
revision: delta.graphRevision,
viewportRevision: delta.toViewportRevision,
emissionSeq: delta.emissionSeq,
bufferStartIndex: nextBufferStartIndex,
bufferEndIndex: nextBufferStartIndex + nextRows.length,
layoutRowCount: delta.layoutRowCount,
totalHeightPx: delta.totalHeightPx,
bufferEndOffsetPx: delta.bufferEndOffsetPx,
rows: nextRows,
offsetsPx: nextOffsets,
mode: current.mode,
scrollTopTarget: delta.scrollTopTarget ?? null,
diagnostics: delta.diagnostics,
lastGeneration: current.lastGeneration,
};
}

/**
 * Largest local index `i` where `offsetsPx[i] <= targetPx`. Because buffered
 * rows are contiguous, that row's `[top, bottom)` span contains `targetPx`.
 * Clamped to `[0, offsetsPx.length - 1]`. Assumes a non-empty ascending array.
 */
function localIndexAtOffset(offsetsPx: readonly number[], targetPx: number): number {
let low = 0;
let high = offsetsPx.length - 1;
let result = 0;
while (low <= high) {
const mid = (low + high) >> 1;
if (offsetsPx[mid] <= targetPx) {
result = mid;
low = mid + 1;
} else {
high = mid - 1;
}
}
return result;
}

export class TranscriptViewportStore {
private readonly projections = new SvelteMap<string, TranscriptViewportProjection>();
private readonly bufferProjections = new SvelteMap<string, BufferProjection>();
private readonly attachmentStatus = new SvelteMap<string, ViewportAttachmentStatus>();
private readonly protocol = new SvelteMap<string, ViewportProtocol>();

applyVisibleWindow(window: VisibleTranscriptWindowPayload): boolean {
if (!this.claimProtocol(window.sessionId, "visibleWindow")) {
return false;
}
const current = this.projections.get(window.sessionId) ?? null;
if (!isNewerRevision(current, window)) {
return false;
}
this.projections.set(window.sessionId, projectionFromWindow(window));
this.markAttached(window.sessionId);
return true;
}

/**
 * Apply a full buffer push (reset). Ordered strictly by the monotonic
 * `emissionSeq` — the single apply-order authority shared across the
 * command-reply and event-stream channels. A push is accepted iff there is
 * no current buffer OR `push.emissionSeq > current.emissionSeq`. Gating by
 * `emissionSeq` (rather than `(graphRevision, viewportRevision)`) is required
 * because a forced gap-recovery / bootstrap push can carry an unchanged
 * revision but a strictly higher seq; a revision gate would wrongly reject it
 * and strand the consumer behind a permanent delta gap. A stale refill built
 * at an older point carries a lower seq and is correctly dropped.
 * `requestGeneration` is retained only for the controller to correlate refill
 * requests.
 */
applyBufferPush(push: ViewportBufferPush): boolean {
if (!this.claimProtocol(push.sessionId, "buffer")) {
return false;
}
const current = this.bufferProjections.get(push.sessionId) ?? null;
if (current !== null && push.emissionSeq <= current.emissionSeq) {
return false;
}
this.bufferProjections.set(push.sessionId, projectionFromPush(push));
this.markAttached(push.sessionId);
return true;
}

/**
 * Apply an incremental buffer delta. Strict-chain on the monotonic
 * `emissionSeq` (the total-order authority — NOT `viewportRevision`, which does
 * not advance on streaming appends). Applied iff the session is on the buffer
 * protocol, a base buffer exists, and `delta.emissionSeq === current.emissionSeq
 * + 1`. A sequence that skips ahead yields a `gap` (the controller must request
 * a fresh full push); a sequence at or behind the current one yields `stale` (an
 * idempotent no-op — a duplicate or reordered older payload). Both leave the
 * projection untouched. Returns the scroll correction the controller must apply
 * (the store never owns scrollTop).
 */
applyBufferDelta(delta: ViewportBufferDelta): BufferDeltaResult {
if (!this.claimProtocol(delta.sessionId, "buffer")) {
return { status: "rejected" };
}
const current = this.bufferProjections.get(delta.sessionId) ?? null;
if (current === null) {
return { status: "gap" };
}
if (delta.emissionSeq <= current.emissionSeq) {
return { status: "stale" };
}
if (delta.emissionSeq !== current.emissionSeq + 1) {
return { status: "gap" };
}
this.bufferProjections.set(delta.sessionId, projectionFromDelta(current, delta));
this.markAttached(delta.sessionId);
return {
status: "applied",
scrollAnchorCorrectionPx: delta.scrollAnchorCorrectionPx ?? null,
scrollTopTarget: delta.scrollTopTarget ?? null,
};
}

getProjection(sessionId: string | null): TranscriptViewportProjection | null {
if (sessionId === null) {
return null;
}
return this.projections.get(sessionId) ?? null;
}

getBufferProjection(sessionId: string | null): BufferProjection | null {
if (sessionId === null) {
return null;
}
return this.bufferProjections.get(sessionId) ?? null;
}

/**
 * Resolve which rows fall in `[scrollTopPx, scrollTopPx + viewportHeightPx)`
 * locally (no IPC), padded by `overscanRows` on each side and clamped to the
 * buffer bounds. Returns `null` if no buffer projection exists.
 */
resolveVisibleSlice(
sessionId: string | null,
scrollTopPx: number,
viewportHeightPx: number,
overscanRows: number
): ResolvedVisibleSlice | null {
const projection = this.getBufferProjection(sessionId);
if (projection === null) {
return null;
}
const { offsetsPx, rows, bufferStartIndex } = projection;
if (offsetsPx.length === 0) {
return { startIndex: bufferStartIndex, endIndex: bufferStartIndex, rows: [], offsetsPx: [] };
}
const firstLocal = localIndexAtOffset(offsetsPx, scrollTopPx);
const lastLocal = localIndexAtOffset(
offsetsPx,
Math.max(scrollTopPx, scrollTopPx + viewportHeightPx - 1)
);
const startLocal = Math.max(0, firstLocal - overscanRows);
const endLocal = Math.min(offsetsPx.length, lastLocal + 1 + overscanRows);
return {
startIndex: bufferStartIndex + startLocal,
endIndex: bufferStartIndex + endLocal,
rows: rows.slice(startLocal, endLocal),
offsetsPx: offsetsPx.slice(startLocal, endLocal),
};
}

/**
 * True when the visible pixel range is within `thresholdPx` of a buffer edge
 * AND that edge is not also the layout extreme (so there is more canonical
 * content to fetch past it).
 */
needsRefill(
sessionId: string | null,
scrollTopPx: number,
viewportHeightPx: number,
thresholdPx: number
): boolean {
const projection = this.getBufferProjection(sessionId);
if (projection === null || projection.offsetsPx.length === 0) {
return false;
}
const bufferTopPx = projection.offsetsPx[0];
const hasContentAbove = projection.bufferStartIndex > 0;
const nearTop = scrollTopPx - bufferTopPx < thresholdPx;
if (hasContentAbove && nearTop) {
return true;
}
const hasContentBelow = projection.bufferEndIndex < projection.layoutRowCount;
const visibleBottomPx = scrollTopPx + viewportHeightPx;
const nearBottom = projection.bufferEndOffsetPx - visibleBottomPx < thresholdPx;
return hasContentBelow && nearBottom;
}

/**
 * True when the visible pixel range falls entirely outside the buffered span
 * `[offsetsPx[0], bufferEndOffsetPx)` — e.g. a jump scroll. The controller
 * should request an urgent full push. Also true when no buffer exists.
 */
isOutsideBuffer(
sessionId: string | null,
scrollTopPx: number,
viewportHeightPx: number
): boolean {
const projection = this.getBufferProjection(sessionId);
if (projection === null || projection.offsetsPx.length === 0) {
return true;
}
const bufferTopPx = projection.offsetsPx[0];
const visibleBottomPx = scrollTopPx + viewportHeightPx;
return visibleBottomPx <= bufferTopPx || scrollTopPx >= projection.bufferEndOffsetPx;
}

getAttachmentStatus(sessionId: string | null): ViewportAttachmentStatus {
if (sessionId === null) {
return "attached";
}
return this.attachmentStatus.get(sessionId) ?? "attached";
}

markReattaching(sessionId: string): void {
this.attachmentStatus.set(sessionId, "reattaching");
this.projections.delete(sessionId);
this.bufferProjections.delete(sessionId);
this.protocol.delete(sessionId);
}

markReattachFailed(sessionId: string): void {
// Only the in-flight "reattaching" episode may transition to failed. This
// guards two cases: removeSession having already cleared the entry (so a
// late connect-failure callback can't resurrect a dead session), and an
// accepted window having already flipped the status back to "attached"
// (so a late watchdog can't clobber a successful re-attach).
if (this.attachmentStatus.get(sessionId) === "reattaching") {
this.attachmentStatus.set(sessionId, "reattachFailed");
}
}

private markAttached(sessionId: string): void {
const status = this.attachmentStatus.get(sessionId);
if (status !== undefined && status !== "attached") {
this.attachmentStatus.set(sessionId, "attached");
}
}

/**
 * Lock a session to a wire protocol on first accepted payload. Returns false
 * (and mutates nothing) if the session is already locked to the other
 * protocol, so old and new paths never write the same projection.
 */
private claimProtocol(sessionId: string, protocol: ViewportProtocol): boolean {
const current = this.protocol.get(sessionId);
if (current === undefined) {
this.protocol.set(sessionId, protocol);
return true;
}
return current === protocol;
}

removeSession(sessionId: string): void {
this.projections.delete(sessionId);
this.bufferProjections.delete(sessionId);
this.attachmentStatus.delete(sessionId);
this.protocol.delete(sessionId);
}
}
