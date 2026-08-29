<script lang="ts">
import {
	Button,
	ChipShell,
	ControlTokensShowcase,
	controlTokensShowcaseMeta,
	Input,
	Kbd,
	KbdGroup,
	PillButton,
	Separator,
	Switch,
} from "@acepe/ui";

import DsSection from "$lib/design-system/ds-section.svelte";

let switchOn = $state(true);
let fieldValue = $state("");

const pillVariants = ["primary", "outline", "ghost", "soft", "invert"] as const;
const pillSizes = ["xs", "sm", "md", "default"] as const;
</script>

<div class="flex flex-col gap-14">
	<header class="max-w-2xl">
		<h1 class="text-2xl font-medium tracking-tight">Controls</h1>
		<p class="mt-2 text-sm leading-relaxed text-muted-foreground">
			These are the real components from
			<span class="font-mono text-xs">@acepe/ui</span>, imported and rendered here exactly as the
			desktop app imports them. Nothing on this page is a copy, so a variant that looks wrong here
			is wrong in the app.
		</p>
	</header>

	<DsSection
		id="button"
		title={controlTokensShowcaseMeta.title}
		description={controlTokensShowcaseMeta.description}
	>
		<ControlTokensShowcase />
	</DsSection>

	<DsSection
		id="fields"
		title="Fields"
		description="Input and Switch. Both take their border from --input and their focus ring from --ring."
	>
		<div class="grid gap-4 sm:grid-cols-2">
			<div class="rounded-lg border border-border/60 bg-card p-4">
				<p class="mb-3 font-mono text-[11px] font-medium">Input</p>
				<div class="flex flex-col gap-2.5">
					<Input placeholder="Search sessions" bind:value={fieldValue} />
					<Input placeholder="Disabled" disabled />
					<Input placeholder="Invalid" aria-invalid="true" />
				</div>
				<p class="mt-3 font-mono text-[10px] text-muted-foreground">
					value: {fieldValue || "—"}
				</p>
			</div>

			<div class="rounded-lg border border-border/60 bg-card p-4">
				<p class="mb-3 font-mono text-[11px] font-medium">Switch</p>
				<div class="flex flex-col gap-3">
					<label class="flex items-center gap-2.5 text-sm">
						<Switch bind:checked={switchOn} />
						<span>Bound — {switchOn ? "on" : "off"}</span>
					</label>
					<label class="flex items-center gap-2.5 text-sm text-muted-foreground">
						<Switch checked={false} disabled />
						<span>Disabled</span>
					</label>
				</div>
			</div>
		</div>
	</DsSection>

	<DsSection
		id="chips"
		title="Chips and keys"
		description="ChipShell is the shared surface behind file badges, model chips and tool pills. PillButton is the marketing CTA shape."
	>
		<div class="flex flex-col gap-4">
			<div class="rounded-lg border border-border/60 bg-card p-4">
				<p class="mb-3 font-mono text-[11px] font-medium">ChipShell</p>
				<div class="flex flex-wrap items-center gap-2">
					<ChipShell>{#snippet children()}Static badge{/snippet}</ChipShell>
					<ChipShell interactive as="button">
						{#snippet children()}Interactive{/snippet}
					</ChipShell>
					<ChipShell interactive selected as="button">
						{#snippet children()}Selected{/snippet}
					</ChipShell>
					<ChipShell density="inline">{#snippet children()}Inline density{/snippet}</ChipShell>
					<ChipShell density="plain">{#snippet children()}Plain density{/snippet}</ChipShell>
				</div>
			</div>

			<div class="rounded-lg border border-border/60 bg-card p-4">
				<p class="mb-3 font-mono text-[11px] font-medium">Kbd</p>
				<div class="flex flex-wrap items-center gap-4 text-sm">
					<KbdGroup>
						{#snippet children()}
							<Kbd>{#snippet children()}⌘{/snippet}</Kbd>
							<Kbd>{#snippet children()}K{/snippet}</Kbd>
						{/snippet}
					</KbdGroup>
					<KbdGroup>
						{#snippet children()}
							<Kbd>{#snippet children()}⇧{/snippet}</Kbd>
							<Kbd>{#snippet children()}⏎{/snippet}</Kbd>
						{/snippet}
					</KbdGroup>
				</div>
			</div>

			<div class="rounded-lg border border-border/60 bg-card p-4">
				<p class="mb-3 font-mono text-[11px] font-medium">PillButton</p>
				<div class="flex flex-col gap-3">
					<div class="flex flex-wrap items-center gap-2">
						{#each pillVariants as variant (variant)}
							<PillButton {variant} size="sm">
								{#snippet children()}{variant}{/snippet}
							</PillButton>
						{/each}
					</div>
					<div class="flex flex-wrap items-center gap-2">
						{#each pillSizes as size (size)}
							<PillButton variant="outline" {size}>
								{#snippet children()}{size}{/snippet}
							</PillButton>
						{/each}
					</div>
				</div>
			</div>
		</div>
	</DsSection>

	<DsSection
		id="structure"
		title="Structure"
		description="Separator draws the hairlines. It is the only divider — a hand-rolled border will drift from --border."
	>
		<div class="rounded-lg border border-border/60 bg-card p-4">
			<div class="flex items-center gap-3 text-sm">
				<Button variant="ghost" size="sm">{#snippet children()}Keep{/snippet}</Button>
				<Separator orientation="vertical" class="h-4" />
				<Button variant="ghost" size="sm">{#snippet children()}Undo{/snippet}</Button>
				<Separator orientation="vertical" class="h-4" />
				<span class="text-muted-foreground">3 files changed</span>
			</div>
			<Separator class="my-4" />
			<p class="text-sm text-muted-foreground">Horizontal separator above.</p>
		</div>
	</DsSection>
</div>
