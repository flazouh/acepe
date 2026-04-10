#!/usr/bin/env bun
import { join } from "node:path";

import { z } from "zod";

const ProbeSchema = z.object({
	project_path: z.string(),
	provider_model_ids: z.array(z.string()),
	discovery_attempted_in_app: z.boolean(),
	hydrated_model_ids: z.array(z.string()),
	cli_probe: z
		.object({
			attempted: z.boolean(),
			command: z.string(),
			args: z.array(z.string()),
			elapsed_ms: z.number(),
			status_code: z.number().nullable(),
			timed_out: z.boolean(),
			parsed_model_ids: z.array(z.string()),
			error: z.string().nullable(),
		})
		.nullable(),
});

type ProbeReport = z.infer<typeof ProbeSchema>;

function printUsage(): void {
	console.error(`
Usage: bun run scripts/probe-claude-model-hydration.ts [projectPath] [--skip-cli-probe]

Examples:
  bun run scripts/probe-claude-model-hydration.ts
  bun run scripts/probe-claude-model-hydration.ts /Users/example/Documents/acepe
  bun run scripts/probe-claude-model-hydration.ts --skip-cli-probe

Defaults:
  projectPath      repo root inferred from this script location
  --skip-cli-probe skip timing the old slow 'claude -p' model discovery command
`);
}

function formatMs(ms: number): string {
	return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms} ms`;
}

function printReport(report: ProbeReport): void {
	console.log("\nClaude cc-sdk model hydration probe");
	console.log("====================================");
	console.log(`Project path: ${report.project_path}`);
	console.log(`Provider defaults: ${report.provider_model_ids.join(", ")}`);
	console.log(`Hydrated models: ${report.hydrated_model_ids.join(", ")}`);
	console.log(
		`Would current app run CLI discovery during hydration? ${report.discovery_attempted_in_app ? "yes" : "no"}`
	);

	if (report.cli_probe) {
		console.log("");
		console.log("Legacy CLI discovery probe");
		console.log("--------------------------");
		console.log(`Attempted: ${report.cli_probe.attempted ? "yes" : "no"}`);
		console.log(`Command: ${report.cli_probe.command} ${report.cli_probe.args.join(" ")}`);
		console.log(`Elapsed: ${formatMs(report.cli_probe.elapsed_ms)}`);
		console.log(
			`Status: ${report.cli_probe.status_code !== null ? String(report.cli_probe.status_code) : "none"}`
		);
		console.log(`Timed out: ${report.cli_probe.timed_out ? "yes" : "no"}`);
		console.log(
			`Parsed model ids: ${report.cli_probe.parsed_model_ids.length > 0 ? report.cli_probe.parsed_model_ids.join(", ") : "none"}`
		);

		if (report.cli_probe.error) {
			console.log(`Error: ${report.cli_probe.error}`);
		}
	}

	console.log("");
	if (report.discovery_attempted_in_app) {
		console.log("Verdict: current code would still invoke CLI discovery during hydration.");
	} else {
		console.log(
			"Verdict: current code uses provider defaults immediately and skips the blocking CLI probe."
		);
	}
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	if (args.includes("--help") || args.includes("-h")) {
		printUsage();
		process.exit(0);
	}

	const skipCliProbe = args.includes("--skip-cli-probe");
	const positionalArgs = args.filter((arg) => arg !== "--skip-cli-probe");
	const desktopDir = join(import.meta.dir, "..");
	const manifestPath = join(desktopDir, "src-tauri", "Cargo.toml");
	const defaultProjectPath = join(import.meta.dir, "..", "..", "..");
	const projectPath = positionalArgs[0] ? positionalArgs[0] : defaultProjectPath;

	const cargoArgs = [
		"run",
		"--manifest-path",
		manifestPath,
		"--",
		"--probe-claude-model-hydration",
		projectPath,
	];

	if (skipCliProbe) {
		cargoArgs.push("--skip-cli-probe");
	}

	const proc = Bun.spawn(["cargo"].concat(cargoArgs), {
		cwd: desktopDir,
		stdout: "pipe",
		stderr: "pipe",
	});

	const stdoutText = await new Response(proc.stdout).text();
	const stderrText = await new Response(proc.stderr).text();
	const exitCode = await proc.exited;

	if (exitCode !== 0) {
		const errorText = stderrText.trim().length > 0 ? stderrText.trim() : stdoutText.trim();
		console.error(errorText);
		process.exit(exitCode);
	}

	const parsed = ProbeSchema.safeParse(JSON.parse(stdoutText));
	if (!parsed.success) {
		console.error("Failed to parse probe output as expected JSON.");
		console.error(stdoutText);
		process.exit(1);
	}

	printReport(parsed.data);
}

await main();
