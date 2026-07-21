/**
 * SessionExportService — the export slice of the session store, extracted as a
 * composed service (see docs/adr/0002). Read-only: projects a canonical
 * `SessionStateGraph` to markdown or JSON export content. Owns no state; reads
 * canonical facts through injected accessor closures. GOD-safe — pure
 * canonical-graph → export-string transforms, no provider repair.
 */
import { err, ok, type Result } from "neverthrow";
import type { SessionStateGraph } from "../../services/acp-types.js";
import { sessionColdFromSlices } from "../application/dto/session-cold.js";
import { sessionGraphToJsonExportContent } from "../utils/session-export.js";
import { sessionGraphToMarkdown } from "../utils/session-to-markdown.js";
import {
	type SessionExportContentError,
	sessionExportContentError,
} from "./session-graph-builders.js";
import type { SessionIdentity, SessionMetadata } from "./types.js";

export interface SessionExportDeps {
	readonly getSessionStateGraph: (sessionId: string) => SessionStateGraph | null;
	readonly getSessionIdentity: (sessionId: string) => SessionIdentity | undefined;
	readonly getSessionMetadata: (sessionId: string) => SessionMetadata | undefined;
}

export class SessionExportService {
	constructor(private readonly deps: SessionExportDeps) {}

	getMarkdownExportContent(sessionId: string): Result<string, SessionExportContentError> {
		const graph = this.deps.getSessionStateGraph(sessionId);
		if (graph === null) {
			return err(sessionExportContentError("thread_content_not_loaded"));
		}

		return ok(sessionGraphToMarkdown(graph));
	}

	getJsonExportContent(sessionId: string): Result<string, SessionExportContentError> {
		const sessionIdentity = this.deps.getSessionIdentity(sessionId);
		const sessionMetadata = this.deps.getSessionMetadata(sessionId);
		if (!sessionIdentity || !sessionMetadata) {
			return err(sessionExportContentError("session_not_found"));
		}

		const graph = this.deps.getSessionStateGraph(sessionId);
		if (graph === null) {
			return err(sessionExportContentError("thread_content_not_loaded"));
		}

		return ok(
			sessionGraphToJsonExportContent(
				sessionColdFromSlices(sessionIdentity, sessionMetadata),
				graph
			)
		);
	}
}
