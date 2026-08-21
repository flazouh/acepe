import {
	judgeLiveWindowProof,
	RPC_ROUNDTRIP_MESSAGE,
	RPC_ROUNDTRIP_PREFIX,
	SHELL_PROOF_LOG_PATH,
} from "@acepe/electrobun-shell";

export const SYSTEM_EVENTS_VISIBLE_PROCESSES =
	'tell application "System Events" to get name of every process whose background only is false';

export const liveLauncherPath = (appPath: string): string => `${appPath}/Contents/MacOS/launcher`;

export const liveLauncherCwd = (appPath: string): string => `${appPath}/Contents/MacOS`;

export const DEFAULT_LIVE_APP_PATH = "/tmp/Acepe.app";

export const LIVE_PROOF_WAIT_MS = 20_000;

export const LIVE_PROOF_POLL_MS = 500;

export const proveLiveWindow = (input: {
	readonly logText: string;
	readonly processListStdout: string;
}): {
	readonly echo: string | null;
	readonly acepeVisible: boolean;
	readonly passed: boolean;
	readonly expectedEcho: string;
} => {
	const judged = judgeLiveWindowProof({
		logText: input.logText,
		processListStdout: input.processListStdout,
	});
	return {
		echo: judged.echo,
		acepeVisible: judged.acepeVisible,
		passed: judged.passed,
		expectedEcho: RPC_ROUNDTRIP_MESSAGE,
	};
};

export const SYSTEM_EVENTS_SCRIPT = SYSTEM_EVENTS_VISIBLE_PROCESSES;

export const logHasRpcRoundtrip = (logText: string): boolean =>
	logText.includes(`${RPC_ROUNDTRIP_PREFIX}: ${RPC_ROUNDTRIP_MESSAGE}`);

if (import.meta.main) {
	const { spawn, spawnSync } = await import("node:child_process");
	const { existsSync, readFileSync } = await import("node:fs");
	const appPath = process.argv[2] ?? DEFAULT_LIVE_APP_PATH;
	const launcher = liveLauncherPath(appPath);
	const cwd = liveLauncherCwd(appPath);
	const child = spawn(launcher, [], {
		cwd,
		stdio: ["ignore", "pipe", "pipe"],
	});
	let stdioText = "";
	child.stdout.on("data", (chunk: Buffer) => {
		stdioText += chunk.toString();
	});
	child.stderr.on("data", (chunk: Buffer) => {
		stdioText += chunk.toString();
	});
	const readProofLog = (): string => {
		if (existsSync(SHELL_PROOF_LOG_PATH) === false) {
			return "";
		}
		return readFileSync(SHELL_PROOF_LOG_PATH, "utf8");
	};
	const polls = Math.ceil(LIVE_PROOF_WAIT_MS / LIVE_PROOF_POLL_MS);
	let logText = stdioText;
	for (let i = 0; i < polls; i++) {
		spawnSync("sleep", [String(LIVE_PROOF_POLL_MS / 1000)]);
		logText = `${stdioText}\n${readProofLog()}`;
		if (logHasRpcRoundtrip(logText) === true) {
			break;
		}
	}
	const osa = spawnSync("osascript", ["-e", SYSTEM_EVENTS_VISIBLE_PROCESSES], {
		encoding: "utf8",
	});
	const proof = proveLiveWindow({
		logText,
		processListStdout: osa.stdout,
	});
	child.kill();
	process.stdout.write(`${JSON.stringify(proof)}\n`);
	process.stdout.write(logText);
	if (proof.passed === false) {
		process.exit(1);
	}
}
