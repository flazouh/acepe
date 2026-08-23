#!/usr/bin/env bun
/**
 * Tracks the migrate step (#249) and enforces the contract step (#250).
 *
 * Counts files importing tauri-command-client. During migration the count
 * only goes down: the baseline below is a ratchet, and a batch that adds an
 * importer fails. When the count reaches zero, #250 deletes the client and
 * flips ALLOW_ANY to false so it cannot come back.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const BASELINE = 13;
const ROOT = join(import.meta.dir, "..", "src");

const importers: Array<string> = [];
const walk = (dir: string): void => {
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) {
			walk(path);
			continue;
		}
		if (!/\.(ts|svelte)$/.test(name)) continue;
		if (path.includes("tauri-command-client")) continue;
		const body = readFileSync(path, "utf8");
		if (body.includes("tauri-command-client")) importers.push(path.replace(`${ROOT}/`, ""));
	}
};
walk(ROOT);

console.log(`tauri-command-client importers: ${importers.length} (ratchet: ${BASELINE})`);
if (importers.length > BASELINE) {
	console.error(`REGRESSION: importer count rose above the ratchet.`);
	for (const f of importers) console.error(`  ${f}`);
	process.exit(1);
}
