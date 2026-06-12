import type { CanonicalSessionProjection } from "../canonical-session-projection.js";
import type { RowTokenStream } from "../canonical-session-projection.js";
import { emptyRowTokenStream } from "../transcript-delta.js";
import type { SessionClockAnchor } from "../canonical-session-projection.js";

export function preserveCanonicalStreamingState(projection: CanonicalSessionProjection | null): {
	readonly tokenStream: ReadonlyMap<string, RowTokenStream>;
	readonly clockAnchor: SessionClockAnchor | null;
} {
	return {
		tokenStream: projection?.tokenStream ?? emptyRowTokenStream(),
		clockAnchor: projection?.clockAnchor ?? null,
	};
}
