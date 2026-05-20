<script lang="ts">
import { AgentPanelFooter, AgentPanelWorktreeTogglePill } from "@acepe/ui/agent-panel";
import { InputContainer } from "@acepe/ui/input-container";
import Seo from "$lib/components/seo/seo.svelte";
import { CaretDown, FolderOpen, GitBranch, Paperclip, Robot, Tree, ArrowUp } from "phosphor-svelte";

type WorktreePreviewState = "off" | "on" | "active" | "failed";

const previewStates: readonly WorktreePreviewState[] = ["off", "on", "active", "failed"];

let worktreeState = $state<WorktreePreviewState>("off");
let setupOpen = $state(false);
let autonomous = $state(false);
let currentModeId = $state("build");

const worktreeEnabled = $derived(worktreeState === "on");
const showPreSessionPill = $derived(worktreeState === "off" || worktreeState === "on" || worktreeState === "failed");

function setWorktreeState(nextState: WorktreePreviewState): void {
	worktreeState = nextState;
	if (nextState !== "on" && nextState !== "off") {
		setupOpen = false;
	}
}

function toggleWorktree(): void {
	worktreeState = worktreeEnabled ? "off" : "on";
}
</script>

<Seo
	title="Dev: Worktree composer preview"
	description="Internal preview surface for the worktree composer component."
	noindex
/>

<main class="min-h-screen bg-background text-foreground">
	<section class="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-8">
		<header class="mb-8 flex flex-wrap items-end justify-between gap-4">
			<div>
				<p class="mb-2 text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
					Dev-only component preview
				</p>
				<h1 class="text-3xl font-semibold tracking-tight">Worktree composer footer</h1>
				<p class="mt-2 max-w-2xl text-sm text-muted-foreground">
					Full prompt container preview with the new worktree pill placed below the composer on the left.
				</p>
			</div>

			<div class="flex rounded-xl border border-border/60 bg-card/50 p-1">
				{#each previewStates as state (state)}
					<button
						type="button"
						class="rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors {worktreeState === state
							? 'bg-accent text-foreground'
							: 'text-muted-foreground hover:text-foreground'}"
						aria-pressed={worktreeState === state}
						onclick={() => setWorktreeState(state)}
					>
						{state}
					</button>
				{/each}
			</div>
		</header>

		<div class="grid flex-1 grid-cols-[minmax(0,1fr)_18rem] gap-6">
			<section class="min-w-0 rounded-2xl border border-border/70 bg-card/40 shadow-2xl shadow-black/20">
				<div class="flex h-11 items-center justify-between border-b border-border/50 px-4">
					<div class="flex items-center gap-2">
						<span class="size-2 rounded-full bg-success"></span>
						<span class="text-sm font-medium">New session</span>
					</div>
					<span class="text-xs text-muted-foreground">desktop composer layout</span>
				</div>

				<div class="flex min-h-[34rem] flex-col justify-end">
					<div class="px-5 pb-4">
						<div class="mx-auto w-full max-w-3xl">
							<InputContainer
								class="border border-border/50 bg-background/80 shadow-xl shadow-black/20"
								contentClass="px-3 py-2"
							>
								{#snippet content()}
									<div class="mb-2 flex flex-wrap gap-1.5">
										<span class="inline-flex h-6 items-center gap-1 rounded-full border border-border/60 bg-input/30 px-2 text-xs text-muted-foreground">
											<Paperclip size={12} />
											agent-panel.svelte
										</span>
										<span class="inline-flex h-6 items-center gap-1 rounded-full border border-border/60 bg-input/30 px-2 text-xs text-muted-foreground">
											<Paperclip size={12} />
											worktree-toggle-pill.svelte
										</span>
									</div>

									<div class="flex min-w-0 gap-1.5">
										<div class="relative min-h-7 flex-1">
											<div
												role="textbox"
												aria-multiline="true"
												aria-label="Prompt"
												tabindex="0"
												contenteditable="true"
												spellcheck={false}
												class="min-h-7 max-h-[400px] overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground outline-none"
											></div>
											<div class="pointer-events-none absolute left-0 top-0 select-none text-sm leading-relaxed text-muted-foreground">
												Ask an agent to implement the worktree UX…
											</div>
										</div>
										<div class="flex shrink-0 items-end gap-1.5">
											<div class="inline-flex h-7 shrink-0 items-center gap-px" role="group" aria-label="Mode">
												{#each ["plan", "build"] as mode (mode)}
													<button
														type="button"
														aria-pressed={currentModeId === mode}
														class="inline-flex h-7 items-center justify-center gap-1 px-2 text-[11px] font-medium leading-none transition-colors {currentModeId === mode
															? 'bg-accent/50 text-foreground'
															: 'text-muted-foreground hover:text-foreground'}"
														onclick={() => {
															currentModeId = mode;
														}}
													>
														{mode === "plan" ? "Plan" : "Build"}
													</button>
												{/each}
											</div>
											<button
												type="button"
												class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-colors hover:bg-foreground/85"
												aria-label="Send message"
											>
												<ArrowUp size={14} />
											</button>
										</div>
									</div>
								{/snippet}

								{#snippet footer()}
									<div class="flex min-w-0 items-center">
										<button
											type="button"
											class="inline-flex h-7 items-center gap-1 px-2 text-[11px] font-medium text-foreground/85 transition-colors hover:bg-accent/50 hover:text-foreground"
										>
											<img src="/svgs/agents/copilot/copilot-icon-dark.svg" alt="" class="h-3 w-3" />
											GPT-5.5
											<CaretDown size={10} weight="bold" class="text-muted-foreground" />
										</button>
										<div class="h-full w-px bg-border/50"></div>
										<button
											type="button"
											class="inline-flex h-7 items-center gap-1 px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
										>
											<FolderOpen size={13} />
											acepe
										</button>
									</div>

									<div class="ml-auto flex items-center gap-1">
										<div class="flex h-7 items-center gap-1.5 px-1.5 text-sm text-muted-foreground" role="status" aria-label="Context usage">
											<span class="font-mono font-medium tabular-nums">18k/200k</span>
											<div class="flex items-center gap-[1px]" aria-hidden="true">
												{#each Array.from({ length: 10 }) as _, index (index)}
													<span class="h-[10px] w-[3px] rounded-[1px] {index === 0 ? 'bg-success opacity-100' : 'bg-border opacity-55'}"></span>
												{/each}
											</div>
										</div>
										<button
											type="button"
											class="flex h-7 w-7 items-center justify-center transition-colors hover:bg-accent/50 {autonomous
												? 'text-purple-400'
												: 'text-muted-foreground hover:text-foreground'}"
											aria-label="Autonomous"
											aria-pressed={autonomous}
											onclick={() => {
												autonomous = !autonomous;
											}}
										>
											<Robot size={14} weight={autonomous ? "fill" : "regular"} />
										</button>
									</div>
								{/snippet}
							</InputContainer>

							<div class="relative">
								<AgentPanelFooter
									browserTitle="Toggle browser"
									browserAriaLabel="Toggle browser"
									terminalTitle="Toggle terminal"
									terminalAriaLabel="Toggle terminal"
								>
									{#snippet left()}
										<div class="flex items-center divide-x divide-border/50">
											{#if showPreSessionPill}
												<div class="px-1">
													<AgentPanelWorktreeTogglePill
														label="Worktree"
														enabled={worktreeEnabled}
														failureMessage={worktreeState === "failed"
															? "Branch setup command exited 1"
															: null}
														onToggle={toggleWorktree}
														onRetry={() => setWorktreeState("on")}
														onDismiss={() => setWorktreeState("off")}
													>
														{#snippet trailing()}
															<button
																type="button"
																class="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
																aria-label="Setup scripts"
																aria-expanded={setupOpen}
																onclick={() => {
																	setupOpen = !setupOpen;
																}}
															>
																<CaretDown
																	size={10}
																	weight="bold"
																	class="transition-transform duration-150 {setupOpen ? 'rotate-180' : ''}"
																/>
															</button>
														{/snippet}
													</AgentPanelWorktreeTogglePill>
												</div>
											{:else}
												<button
													type="button"
													class="inline-flex h-7 items-center gap-1.5 px-3 text-[0.6875rem] font-medium text-foreground transition-colors hover:bg-accent/50"
												>
													<Tree size={12} weight="fill" class="text-success" />
													<span>acepe-worktree-ux</span>
												</button>
											{/if}
										</div>
									{/snippet}
								</AgentPanelFooter>

								{#if setupOpen && showPreSessionPill && worktreeState !== "failed"}
									<div class="absolute bottom-9 left-1 z-10 w-[28rem] rounded-xl border border-border/70 bg-popover p-3 text-popover-foreground shadow-2xl shadow-black/30">
										<div class="mb-3 flex items-center justify-between">
											<div>
												<h2 class="text-sm font-medium">Setup scripts</h2>
												<p class="text-xs text-muted-foreground">Commands run after creating the worktree.</p>
											</div>
											<GitBranch size={14} class="text-muted-foreground" />
										</div>
										<div class="space-y-2">
											<div class="rounded-lg border border-border/60 bg-background/70 px-3 py-2 font-mono text-xs text-muted-foreground">
												bun install --frozen-lockfile
											</div>
											<div class="rounded-lg border border-border/60 bg-background/70 px-3 py-2 font-mono text-xs text-muted-foreground">
												bun run check
											</div>
										</div>
									</div>
								{/if}
							</div>
						</div>
					</div>
				</div>
			</section>

			<aside class="rounded-2xl border border-border/70 bg-card/40 p-4">
				<h2 class="text-sm font-semibold">States</h2>
				<div class="mt-4 space-y-3 text-sm">
					<div>
						<p class="font-medium">Off</p>
						<p class="text-muted-foreground">Muted tree icon. Click pill to enable worktree for the next send.</p>
					</div>
					<div>
						<p class="font-medium">On</p>
						<p class="text-muted-foreground">Filled green tree icon. Caret opens setup scripts.</p>
					</div>
					<div>
						<p class="font-medium">Active</p>
						<p class="text-muted-foreground">Pill is replaced by the existing active worktree footer button.</p>
					</div>
					<div>
						<p class="font-medium">Failed</p>
						<p class="text-muted-foreground">Inline destructive status with Retry and Dismiss actions.</p>
					</div>
				</div>
			</aside>
		</div>
	</section>
</main>
