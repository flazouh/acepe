import { unlinkSync } from "node:fs";
import { resolve } from "node:path";

import { analyzeDeadCode, type DeadCodeAnalysis } from "./find-dead-code.js";

type DeletableClassification = "strong-dead" | "export-barrel-only";

interface ApplyCliOptions {
	readonly repoRoot: string;
	readonly apply: boolean;
	readonly includeBarrelOnly: boolean;
}

function parseApplyCliOptions(argv: readonly string[]): ApplyCliOptions {
	let repoRoot = process.cwd();
	let apply = false;
	let includeBarrelOnly = false;

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--root") {
			repoRoot = argv[index + 1] ?? repoRoot;
			index += 1;
			continue;
		}
		if (arg === "--apply") {
			apply = true;
			continue;
		}
		if (arg === "--include-barrel-only") {
			includeBarrelOnly = true;
		}
	}

	return {
		repoRoot,
		apply,
		includeBarrelOnly,
	};
}

function selectDeletableCandidates(
	analysis: DeadCodeAnalysis,
	includeBarrelOnly: boolean
): readonly { readonly path: string; readonly classification: DeletableClassification }[] {
	const classifications: DeletableClassification[] = ["strong-dead"];
	if (includeBarrelOnly) {
		classifications.push("export-barrel-only");
	}

	const selected: { path: string; classification: DeletableClassification }[] = [];
	for (const classification of classifications) {
		for (const candidate of analysis.candidates) {
			if (candidate.classification === classification) {
				selected.push({
					path: candidate.path,
					classification,
				});
			}
		}
	}

	selected.sort((left, right) => left.path.localeCompare(right.path));
	return selected;
}

function runApplyCli(): void {
	const cli = parseApplyCliOptions(process.argv.slice(2));
	const analysisResult = analyzeDeadCode({
		repoRoot: resolve(cli.repoRoot),
		includeGitStatus: true,
	});
	if (analysisResult.isErr()) {
		console.error(analysisResult.error);
		process.exit(1);
	}

	const candidates = selectDeletableCandidates(analysisResult.value, cli.includeBarrelOnly);
	if (candidates.length === 0) {
		process.stdout.write("No deletable dead-code candidates found.\n");
		return;
	}

	const modeLabel = cli.apply ? "Deleting" : "Dry run (pass --apply to delete)";
	process.stdout.write(`${modeLabel} ${String(candidates.length)} file(s):\n`);
	for (const candidate of candidates) {
		process.stdout.write(`- [${candidate.classification}] ${candidate.path}\n`);
		if (!cli.apply) {
			continue;
		}
		unlinkSync(resolve(cli.repoRoot, candidate.path));
	}

	if (!cli.apply) {
		process.stdout.write(
			"\nNo files were deleted. Re-run with --apply to remove strong-dead candidates"
		);
		if (cli.includeBarrelOnly) {
			process.stdout.write(" (and export-barrel-only candidates)");
		}
		process.stdout.write(
			". Review barrel index.ts exports manually after deleting export-barrel-only files.\n"
		);
	}
}

if (import.meta.main) {
	runApplyCli();
}
