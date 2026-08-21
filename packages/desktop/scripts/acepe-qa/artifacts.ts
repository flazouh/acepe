import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fromPromise } from "@acepe/effect-result/fromPromise";
import * as Effect from "effect/Effect";

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
): Effect.Effect<string, ArtifactWriteFailure> {
	const path = artifactPath(kind, options);
	const directory = options.directory ?? "/tmp";
	return fromPromise(
		() =>
			mkdir(directory, { recursive: true }).then(() =>
				Bun.write(path, `${JSON.stringify(payload, null, 2)}\n`)
			),
		(error) => {
			const normalized = error instanceof Error ? error : new Error("Artifact write failed.");
			return {
				code: "artifact_write_failed",
				message: errorMessage(normalized),
			} satisfies ArtifactWriteFailure;
		}
	).pipe(Effect.map(() => path));
}
