/**
 * Repo entry point for Acepe desktop QA (`bun run qa`).
 *
 * Every command is delegated to the electrobun-qa CLI, which talks to the real
 * Electrobun WebView over the QA unix socket. This wrapper adds one thing the
 * CLI does not own: a UI QA evidence stamp that the Codex Stop hook reads to
 * confirm UI changes were verified against the running app. Only `run` stamps,
 * because only a script actually inspects the DOM.
 */

import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

const CHECKOUT_ROOT = join(import.meta.dir, "..", "..", "..");
const CLI_ENTRY = join(import.meta.dir, "..", "..", "electrobun-qa", "src", "bin.ts");
const EVIDENCE_PATH = join(CHECKOUT_ROOT, ".codex", "state", "ui-qa-evidence.json");

async function writeUiQaEvidence(command: string): Promise<void> {
	await mkdir(dirname(EVIDENCE_PATH), { recursive: true });
	const payload = {
		command,
		status: "ok",
		verifiedAt: new Date().toISOString(),
	};
	await Bun.write(EVIDENCE_PATH, `${JSON.stringify(payload, null, 2)}\n`);
}

const args = Bun.argv.slice(2);

const child = Bun.spawn(["bun", CLI_ENTRY].concat(args), {
	stdin: "inherit",
	stdout: "inherit",
	stderr: "inherit",
});

const exitCode = await child.exited;

if (exitCode === 0 && args[0] === "run") {
	await writeUiQaEvidence(`qa ${args.join(" ")}`);
}

process.exit(exitCode);
