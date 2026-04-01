<script lang="ts">
	import VoiceDownloadProgress from "$lib/components/voice-download-progress.svelte";
	import { Button } from "@acepe/ui/button";
	import {
		CloseAction,
		EmbeddedPanelHeader,
		HeaderActionCell,
		HeaderTitleCell,
	} from "@acepe/ui/panel-header";
	import CheckCircle from "phosphor-svelte/lib/CheckCircle";
	import Palette from "phosphor-svelte/lib/Palette";
	import ShieldCheck from "phosphor-svelte/lib/ShieldCheck";
	import ShieldWarning from "phosphor-svelte/lib/ShieldWarning";
	import XCircle from "phosphor-svelte/lib/XCircle";

	interface Props {
		open: boolean;
		onOpenChange: (open: boolean) => void;
	}

	let { open, onOpenChange }: Props = $props();

	type SidebarItem = { id: string; label: string };
	const sidebarItems: SidebarItem[] = [
		{ id: "permission-card", label: "Permission Card" },
	];
	let activeSection = $state("permission-card");

	const purpleColor = "#9858FF";
	const redColor = "#FF5D5A";
	const greenColor = "var(--success)";

	function close() {
		onOpenChange(false);
	}

	function handleBackdropClick(event: MouseEvent) {
		if (event.target === event.currentTarget) {
			close();
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === "Escape") {
			event.stopPropagation();
			close();
		}
	}
</script>

{#if open}
	<div
		class="fixed inset-0 z-[9997] flex items-center justify-center bg-black/55 p-2 sm:p-4 md:p-5"
		role="dialog"
		aria-modal="true"
		aria-label="Design System"
		tabindex="-1"
		onclick={handleBackdropClick}
		onkeydown={handleKeydown}
	>
		<div
			class="mx-auto flex h-full max-h-[820px] w-full max-w-[860px] flex-col overflow-hidden rounded-xl border border-border/60 bg-background shadow-[0_30px_80px_rgba(0,0,0,0.5)]"
		>
			<!-- Top bar -->
			<EmbeddedPanelHeader>
				<HeaderTitleCell>
					<Palette size={14} weight="fill" class="shrink-0 mr-1.5 text-muted-foreground" />
					<span class="text-[11px] font-semibold font-mono text-foreground select-none truncate leading-none">
						Design System
					</span>
				</HeaderTitleCell>
				<HeaderActionCell>
					<CloseAction onClose={close} title="Close" />
				</HeaderActionCell>
			</EmbeddedPanelHeader>

			<!-- Sidebar + Content -->
			<div class="flex flex-1 min-h-0">
				<!-- Sidebar -->
				<div class="ds-sidebar flex w-[180px] shrink-0 flex-col border-r border-border/50 bg-background">
					<div class="px-2 pt-2 pb-1">
						<span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 px-1.5">
							Components
						</span>
					</div>
					<nav class="flex flex-col gap-0.5 px-2 pb-2">
						{#each sidebarItems as item (item.id)}
							<button
								type="button"
								class="ds-sidebar-item {activeSection === item.id ? 'active' : ''}"
								onclick={() => { activeSection = item.id; }}
							>
								<ShieldWarning size={12} weight="fill" class="shrink-0" style="color: {purpleColor}" />
								<span>{item.label}</span>
							</button>
						{/each}
					</nav>
				</div>

				<!-- Content -->
				<div class="flex-1 min-w-0 overflow-y-auto bg-accent/20">
					<div class="px-8 py-6">
						{#if activeSection === "permission-card"}
							<div class="mb-1 text-xs font-semibold text-foreground/80">Permission Card</div>
							<p class="mb-6 text-[11px] text-muted-foreground/60 max-w-[420px]">
								Compact card above the composer. Header shows tool kind + segmented progress (current segment highlighted). Command wraps naturally. Full-width toolbar buttons.
							</p>

							<div class="flex flex-col gap-6">
								<!-- Variant: Execute command (1st of 3) -->
								<div>
									<div class="mb-2 text-[10px] font-mono font-medium uppercase tracking-wider text-muted-foreground/40">
										Execute — 1st of 3 (current highlighted)
									</div>
									<div class="mx-auto w-full max-w-[320px]">
										<div class="flex min-w-0 flex-col gap-1 overflow-hidden rounded-sm border border-border/60 bg-accent/30 px-1.5 py-1">
											<div class="flex min-w-0 items-center gap-1.5">
												<ShieldWarning weight="fill" size={10} class="shrink-0" style="color: {purpleColor}" />
												<span class="text-[10px] font-mono font-medium text-muted-foreground">Execute</span>
												<div class="shrink-0 ml-auto">
													<VoiceDownloadProgress ariaLabel="Permission 1 of 3" compact={true} label="" percent={33} segmentCount={3} showPercent={false} />
												</div>
											</div>
											<div class="rounded-sm bg-accent/40 px-2 py-1">
												<code class="block font-mono text-[10px] text-foreground/70 whitespace-pre-wrap break-words">$ bun test src/lib/utils.test.ts</code>
											</div>
											<div class="flex w-full items-center gap-1">
												<Button variant="toolbar" size="toolbar" class="flex-1 justify-center">
													<XCircle weight="fill" class="size-3 shrink-0" style="color: {redColor}" />
													<span>Deny</span>
												</Button>
												<Button variant="toolbar" size="toolbar" class="flex-1 justify-center">
													<CheckCircle weight="fill" class="size-3 shrink-0" style="color: {greenColor}" />
													<span>Allow</span>
												</Button>
												<Button variant="toolbar" size="toolbar" class="flex-1 justify-center">
													<ShieldCheck weight="fill" class="size-3 shrink-0" style="color: {purpleColor}" />
													<span>Always Allow</span>
												</Button>
											</div>
										</div>
									</div>
								</div>

								<!-- Variant: Edit — 2nd of 2 -->
								<div>
									<div class="mb-2 text-[10px] font-mono font-medium uppercase tracking-wider text-muted-foreground/40">
										Edit — 2nd of 2 (both filled)
									</div>
									<div class="mx-auto w-full max-w-[320px]">
										<div class="flex min-w-0 flex-col gap-1 overflow-hidden rounded-sm border border-border/60 bg-accent/30 px-1.5 py-1">
											<div class="flex min-w-0 items-center gap-1.5">
												<ShieldWarning weight="fill" size={10} class="shrink-0" style="color: {purpleColor}" />
												<span class="text-[10px] font-mono font-medium text-muted-foreground">Edit</span>
												<div class="shrink-0 ml-auto">
													<VoiceDownloadProgress ariaLabel="Permission 2 of 2" compact={true} label="" percent={100} segmentCount={2} showPercent={false} />
												</div>
											</div>
											<div class="flex w-full items-center gap-1">
												<Button variant="toolbar" size="toolbar" class="flex-1 justify-center">
													<XCircle weight="fill" class="size-3 shrink-0" style="color: {redColor}" />
													<span>Deny</span>
												</Button>
												<Button variant="toolbar" size="toolbar" class="flex-1 justify-center">
													<CheckCircle weight="fill" class="size-3 shrink-0" style="color: {greenColor}" />
													<span>Allow</span>
												</Button>
											</div>
										</div>
									</div>
								</div>

								<!-- Variant: Long command wrapping -->
								<div>
									<div class="mb-2 text-[10px] font-mono font-medium uppercase tracking-wider text-muted-foreground/40">
										Long Command (wrapping)
									</div>
									<div class="mx-auto w-full max-w-[320px]">
										<div class="flex min-w-0 flex-col gap-1 overflow-hidden rounded-sm border border-border/60 bg-accent/30 px-1.5 py-1">
											<div class="flex min-w-0 items-center gap-1.5">
												<ShieldWarning weight="fill" size={10} class="shrink-0" style="color: {purpleColor}" />
												<span class="text-[10px] font-mono font-medium text-muted-foreground">Execute</span>
												<div class="shrink-0 ml-auto">
													<VoiceDownloadProgress ariaLabel="Permission 3 of 5" compact={true} label="" percent={60} segmentCount={5} showPercent={false} />
												</div>
											</div>
											<div class="max-h-[72px] overflow-y-auto rounded-sm bg-accent/40 px-2 py-1">
												<code class="block font-mono text-[10px] text-foreground/70 whitespace-pre-wrap break-words">$ RUST_BACKTRACE=1 cargo test --lib crate::acp::parsers::claude_code_parser::tests::test_infer_tool_kind -- --nocapture</code>
											</div>
											<div class="flex w-full items-center gap-1">
												<Button variant="toolbar" size="toolbar" class="flex-1 justify-center">
													<XCircle weight="fill" class="size-3 shrink-0" style="color: {redColor}" />
													<span>Deny</span>
												</Button>
												<Button variant="toolbar" size="toolbar" class="flex-1 justify-center">
													<CheckCircle weight="fill" class="size-3 shrink-0" style="color: {greenColor}" />
													<span>Allow</span>
												</Button>
												<Button variant="toolbar" size="toolbar" class="flex-1 justify-center">
													<ShieldCheck weight="fill" class="size-3 shrink-0" style="color: {purpleColor}" />
													<span>Always Allow</span>
												</Button>
											</div>
										</div>
									</div>
								</div>

								<!-- Variant: Single permission (no progress bar) -->
								<div>
									<div class="mb-2 text-[10px] font-mono font-medium uppercase tracking-wider text-muted-foreground/40">
										Single Permission (1 of 1)
									</div>
									<div class="mx-auto w-full max-w-[320px]">
										<div class="flex min-w-0 flex-col gap-1 overflow-hidden rounded-sm border border-border/60 bg-accent/30 px-1.5 py-1">
											<div class="flex min-w-0 items-center gap-1.5">
												<ShieldWarning weight="fill" size={10} class="shrink-0" style="color: {purpleColor}" />
												<span class="text-[10px] font-mono font-medium text-muted-foreground">Read</span>
												<div class="shrink-0 ml-auto">
													<VoiceDownloadProgress ariaLabel="Permission 1 of 1" compact={true} label="" percent={100} segmentCount={1} showPercent={false} />
												</div>
											</div>
											<div class="flex w-full items-center gap-1">
												<Button variant="toolbar" size="toolbar" class="flex-1 justify-center">
													<XCircle weight="fill" class="size-3 shrink-0" style="color: {redColor}" />
													<span>Deny</span>
												</Button>
												<Button variant="toolbar" size="toolbar" class="flex-1 justify-center">
													<CheckCircle weight="fill" class="size-3 shrink-0" style="color: {greenColor}" />
													<span>Allow</span>
												</Button>
												<Button variant="toolbar" size="toolbar" class="flex-1 justify-center">
													<ShieldCheck weight="fill" class="size-3 shrink-0" style="color: {purpleColor}" />
													<span>Always Allow</span>
												</Button>
											</div>
										</div>
									</div>
								</div>

								<!-- Toolbar Buttons isolation -->
								<div>
									<div class="mb-2 text-[10px] font-mono font-medium uppercase tracking-wider text-muted-foreground/40">
										Toolbar Buttons (new variant)
									</div>
									<div class="ds-specimen">
										<div class="flex items-center gap-1">
											<Button variant="toolbar" size="toolbar" class="flex-1 justify-center">
												<XCircle weight="fill" class="size-3 shrink-0" style="color: {redColor}" />
												<span>Deny</span>
											</Button>
											<Button variant="toolbar" size="toolbar" class="flex-1 justify-center">
												<CheckCircle weight="fill" class="size-3 shrink-0" style="color: {greenColor}" />
												<span>Allow</span>
											</Button>
											<Button variant="toolbar" size="toolbar" class="flex-1 justify-center">
												<ShieldCheck weight="fill" class="size-3 shrink-0" style="color: {purpleColor}" />
												<span>Always Allow</span>
											</Button>
										</div>
									</div>
								</div>

								<!-- Segmented Progress -->
								<div>
									<div class="mb-2 text-[10px] font-mono font-medium uppercase tracking-wider text-muted-foreground/40">
										Segmented Progress (current highlighted)
									</div>
									<div class="ds-specimen">
										<div class="flex flex-col gap-3">
											<div class="flex items-center gap-3">
												<span class="text-[10px] font-mono text-muted-foreground/50 w-14 shrink-0">1 of 3</span>
												<VoiceDownloadProgress ariaLabel="1 of 3" compact={true} label="" percent={33} segmentCount={3} showPercent={false} />
											</div>
											<div class="flex items-center gap-3">
												<span class="text-[10px] font-mono text-muted-foreground/50 w-14 shrink-0">2 of 3</span>
												<VoiceDownloadProgress ariaLabel="2 of 3" compact={true} label="" percent={66} segmentCount={3} showPercent={false} />
											</div>
											<div class="flex items-center gap-3">
												<span class="text-[10px] font-mono text-muted-foreground/50 w-14 shrink-0">3 of 3</span>
												<VoiceDownloadProgress ariaLabel="3 of 3" compact={true} label="" percent={100} segmentCount={3} showPercent={false} />
											</div>
											<div class="flex items-center gap-3">
												<span class="text-[10px] font-mono text-muted-foreground/50 w-14 shrink-0">3 of 8</span>
												<VoiceDownloadProgress ariaLabel="3 of 8" compact={true} label="" percent={37} segmentCount={8} showPercent={false} />
											</div>
										</div>
									</div>
								</div>
							</div>
						{/if}
					</div>
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	.ds-sidebar-item {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 8px;
		font: inherit;
		font-size: 0.6875rem;
		color: var(--muted-foreground);
		background: transparent;
		border: none;
		border-radius: 6px;
		cursor: pointer;
		text-align: left;
		transition: background 0.12s ease, color 0.12s ease;
	}

	.ds-sidebar-item:hover {
		background: color-mix(in srgb, var(--accent) 50%, transparent);
		color: var(--foreground);
	}

	.ds-sidebar-item.active {
		background: var(--accent);
		color: var(--foreground);
	}

	.ds-specimen {
		border-radius: 6px;
		border: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
		background: color-mix(in srgb, var(--accent) 30%, transparent);
		padding: 12px;
	}
</style>
