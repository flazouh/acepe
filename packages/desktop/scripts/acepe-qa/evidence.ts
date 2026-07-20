import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { ResultAsync } from "neverthrow";
import type { QaStatus } from "./schemas";

export type UiQaEvidenceInput = {
	readonly checkoutRoot: string;
	readonly command: string;
	readonly status: QaStatus;
	readonly summary: readonly string[];
	readonly artifactPath?: string;
	readonly nowIso?: string;
};

export type UiQaEvidenceFailure = {
	readonly code: "ui_qa_evidence_write_failed";
	readonly message: string;
};

function errorMessage(error: Error): string {
	return error.message.length > 0 ? error.message : "Unable to write UI QA evidence.";
}

export function uiQaEvidencePath(checkoutRoot: string): string {
	return join(checkoutRoot, ".codex", "state", "ui-qa-evidence.json");
}

export function writeUiQaEvidence(
	input: UiQaEvidenceInput
): ResultAsync<string, UiQaEvidenceFailure> {
	const path = uiQaEvidencePath(input.checkoutRoot);
	const directory = join(input.checkoutRoot, ".codex", "state");
	const payload = {
		command: input.command,
		status: input.status,
		summary: Array.from(input.summary),
		artifactPath: input.artifactPath ?? null,
		verifiedAt: input.nowIso ?? new Date().toISOString(),
	};
	return ResultAsync.fromPromise(
		mkdir(directory, { recursive: true }).then(() =>
			Bun.write(path, `${JSON.stringify(payload, null, 2)}\n`)
		),
		(error) => {
			const normalized =
				error instanceof Error ? error : new Error("Unable to write UI QA evidence.");
			return {
				code: "ui_qa_evidence_write_failed",
				message: errorMessage(normalized),
			} satisfies UiQaEvidenceFailure;
		}
	).map(() => path);
}
