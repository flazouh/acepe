export {
	resolveElectrobunConfig,
	loadElectrobunConfig,
	makeElectrobunConfig,
	qaSurfaceEnabled,
	electrobunReleaseChannel,
	electrobunCliBuildArgs,
} from "./electrobun-config.ts"
export type { AcepeElectrobunConfig } from "./electrobun-config.ts"
export {
	handlePing,
	pingRequestHandler,
	PingRequest,
	PingResponse,
	formatRpcRoundtripLine,
	formatWindowOpenedLine,
	RPC_ROUNDTRIP_MESSAGE,
	RPC_ROUNDTRIP_PREFIX,
	WINDOW_OPENED_PREFIX,
	SHELL_PROOF_LOG_PATH,
} from "./ping.ts"
export {
	githubSecretToElectrobunEnv,
	hasNotarizeCredentials,
	loadSigningPolicy,
	stapleCommands,
} from "./signing.ts"
export { startAcepeShell } from "./start-acepe-shell.ts"
export type { AcepeRpcWork, AcepeShellHost, AcepeShellRpcHandlers } from "./start-acepe-shell.ts"
export { startShell } from "./start-shell.ts"
export { launchAcepeShellWindow, makeDeferredRpcWork } from "./run-acepe-shell.ts"
export type { LaunchedAcepeShell, ShellIo } from "./run-acepe-shell.ts"
export { SHELL_STARTUP_FAILED_PREFIX, ShellStartupError } from "./shell-startup-error.ts"
export { svelteBundleCopy, svelteBundleViewUrl } from "./svelte-bundle.ts"
export { demoUpdatePlan, nextCalver, patchArtifactsFrom, selectPatchArtifact } from "./updater.ts"
export { acepeWindowSpec } from "./window-spec.ts"
export {
	applyNativeWrapperCwd,
	applyNativeWrapperCwdOrExit,
	joinPathSegments,
	nativeWrapperDirectory,
	NATIVE_WRAPPER_FILENAMES,
} from "./native-wrapper-cwd.ts"
export {
	electrobunWindowOptions,
	realizeAcepeNativeWindow,
	startElectrobunAcepeApp,
} from "./open-native-window.ts"
export type {
	ElectrobunAcepeAppOptions,
	ElectrobunBunBindings,
	ElectrobunWindowHandle,
	ElectrobunWindowOptions,
	LaunchedElectrobunAcepe,
} from "./open-native-window.ts"
export {
	expandStableMacAppIfNeeded,
	findZstFile,
	findZigZstdPath,
	distDirNames,
	stableBundleNeedsExpand,
} from "./stable-bundle-expand.ts"
export {
	judgeLiveWindowProof,
	parseRpcRoundtripEcho,
	parseSystemEventsProcessNames,
	visibleProcessListContainsAcepe,
} from "./live-window-proof.ts"
export { makeLauncherWorkerLoud, launcherWorkerIsLoud } from "./loud-launcher-worker.ts"
export {
	needsGuiProcessRename,
	bunLauncherWrapperScript,
	GUI_PROCESS_FILENAME,
	BUN_RUNTIME_FILENAME,
} from "./gui-process-name.ts"
export { rewriteSvelteKitRootAbsolutePaths } from "./sveltekit-asset-paths.ts"
export {
	acepeShellPingScript,
	injectAcepeShellPingScript,
	ACEPE_SHELL_INLINE_PING_ATTR,
} from "./shell-ping-script.ts"
