import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { ResultAsync } from "neverthrow";

export type ArtifactWriteOptions = {
	readonly directory?: string;
	readonly nowMs?: number;
};

export type ArtifactWriteFailure = {
	readonly code: "artifact_write_failed";
	readonly message: string;
};

function errorMessage(error: Error): string {
	return error.message.length > 0 ? error.message : "Artifact write failed.";
}

export function artifactPath(kind: string, options: ArtifactWriteOptions): string {
	const directory = options.directory ?? "/tmp";
	const nowMs = options.nowMs ?? Date.now();
	return join(directory, `acepe-qa-${kind}-${nowMs.toString()}.json`);
}

export function writeJsonArtifact(
	kind: string,
	payload: object,
	options: ArtifactWriteOptions = {}
): ResultAsync<string, ArtifactWriteFailure> {
	const path = artifactPath(kind, options);
	const directory = options.directory ?? "/tmp";
	return ResultAsync.fromPromise(
		mkdir(directory, { recursive: true }).then(() => Bun.write(path, `${JSON.stringify(payload, null, 2)}\n`)),
		(error) => {
			const normalized = error instanceof Error ? error : new Error("Artifact write failed.");
			return {
				code: "artifact_write_failed",
				message: errorMessage(normalized),
			} satisfies ArtifactWriteFailure;
		}
	).map(() => path);
}
