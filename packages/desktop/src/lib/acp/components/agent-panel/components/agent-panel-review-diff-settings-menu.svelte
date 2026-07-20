<script lang="ts">
import { Button } from "@acepe/ui/button";
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import { HugeiconsIcon } from "@acepe/ui/icons";

import type {
	DiffViewStyle,
	ReviewDiffIndicatorStyle,
	ReviewDiffLineChangeStyle,
	ReviewDiffOptions,
} from "../../modified-files/components/review-diff-view-state.svelte.js";

interface Props {
	diffStyle: DiffViewStyle;
	diffOptions: ReviewDiffOptions;
	onDiffStyleChange: (value: DiffViewStyle) => void;
	onDiffIndicatorStyleChange: (value: ReviewDiffIndicatorStyle) => void;
	onDiffLineChangeStyleChange: (value: ReviewDiffLineChangeStyle) => void;
	onDiffShowBackgroundsChange: (value: boolean) => void;
	onDiffWrapLinesChange: (value: boolean) => void;
	onDiffShowLineNumbersChange: (value: boolean) => void;
}

let {
	diffStyle,
	diffOptions,
	onDiffStyleChange,
	onDiffIndicatorStyleChange,
	onDiffLineChangeStyleChange,
	onDiffShowBackgroundsChange,
	onDiffWrapLinesChange,
	onDiffShowLineNumbersChange,
}: Props = $props();

function handleDiffStyleChange(value: string): void {
	if (value === "unified" || value === "split") {
		onDiffStyleChange(value);
	}
}

function handleDiffIndicatorStyleChange(value: string): void {
	if (value === "bars" || value === "classic" || value === "none") {
		onDiffIndicatorStyleChange(value);
	}
}

function handleDiffLineChangeStyleChange(value: string): void {
	if (value === "none" || value === "word" || value === "character") {
		onDiffLineChangeStyleChange(value);
	}
}
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				variant="secondary"
				size="xs"
				class="shrink-0"
				aria-label="Diff settings"
				title="Diff settings"
				data-testid="review-dialog-diff-settings-trigger"
			>
				<HugeiconsIcon name="settings" class="size-[13px] shrink-0" />
				Diff
			</Button>
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content
		align="end"
		sideOffset={6}
		class="w-64"
		data-testid="review-dialog-diff-settings-menu"
	>
		<DropdownMenu.Group>
			<DropdownMenu.GroupHeading>Layout</DropdownMenu.GroupHeading>
			<DropdownMenu.RadioGroup
				value={diffStyle}
				onValueChange={handleDiffStyleChange}
			>
				<DropdownMenu.RadioItem
					value="unified"
					closeOnSelect={false}
					data-testid="review-dialog-diff-style-unified"
				>
					<HugeiconsIcon name="git-diff-unified" class="size-3" />
					Unified
				</DropdownMenu.RadioItem>
				<DropdownMenu.RadioItem
					value="split"
					closeOnSelect={false}
					data-testid="review-dialog-diff-style-split"
				>
					<HugeiconsIcon name="diff-layout-split" class="size-3" />
					Split
				</DropdownMenu.RadioItem>
			</DropdownMenu.RadioGroup>
		</DropdownMenu.Group>

		<DropdownMenu.Separator />

		<DropdownMenu.Group>
			<DropdownMenu.GroupHeading>Indicators</DropdownMenu.GroupHeading>
			<DropdownMenu.RadioGroup
				value={diffOptions.indicatorStyle}
				onValueChange={handleDiffIndicatorStyleChange}
			>
				<DropdownMenu.RadioItem
					value="bars"
					closeOnSelect={false}
					data-testid="review-dialog-diff-indicators-bars"
				>
					<HugeiconsIcon name="diff-bars" class="size-3" />
					Bars
				</DropdownMenu.RadioItem>
				<DropdownMenu.RadioItem
					value="classic"
					closeOnSelect={false}
					data-testid="review-dialog-diff-indicators-classic"
				>
					<HugeiconsIcon name="diff-classic" class="size-3" />
					Classic
				</DropdownMenu.RadioItem>
				<DropdownMenu.RadioItem
					value="none"
					closeOnSelect={false}
					data-testid="review-dialog-diff-indicators-none"
				>
					<HugeiconsIcon name="minus" class="size-3" />
					None
				</DropdownMenu.RadioItem>
			</DropdownMenu.RadioGroup>
		</DropdownMenu.Group>

		<DropdownMenu.Separator />

		<DropdownMenu.Group>
			<DropdownMenu.GroupHeading>Inline Changes</DropdownMenu.GroupHeading>
			<DropdownMenu.RadioGroup
				value={diffOptions.lineChangeStyle}
				onValueChange={handleDiffLineChangeStyleChange}
			>
				<DropdownMenu.RadioItem
					value="none"
					closeOnSelect={false}
					data-testid="review-dialog-line-change-none"
				>
					<HugeiconsIcon name="minus" class="size-3" />
					None
				</DropdownMenu.RadioItem>
				<DropdownMenu.RadioItem
					value="word"
					closeOnSelect={false}
					data-testid="review-dialog-line-change-word"
				>
					<HugeiconsIcon name="diff-inline-word" class="size-3" />
					Word
				</DropdownMenu.RadioItem>
				<DropdownMenu.RadioItem
					value="character"
					closeOnSelect={false}
					data-testid="review-dialog-line-change-character"
				>
					<HugeiconsIcon name="diff-inline-character" class="size-3" />
					Character
				</DropdownMenu.RadioItem>
			</DropdownMenu.RadioGroup>
		</DropdownMenu.Group>

		<DropdownMenu.Separator />

		<DropdownMenu.Group>
			<DropdownMenu.GroupHeading>Display</DropdownMenu.GroupHeading>
			<DropdownMenu.CheckboxItem
				checked={diffOptions.showBackgrounds}
				onCheckedChange={(checked) => onDiffShowBackgroundsChange(checked === true)}
				closeOnSelect={false}
				data-testid="review-dialog-toggle-backgrounds"
			>
				<HugeiconsIcon name="diff-backgrounds" class="size-3" />
				Backgrounds
			</DropdownMenu.CheckboxItem>
			<DropdownMenu.CheckboxItem
				checked={diffOptions.wrapLines}
				onCheckedChange={(checked) => onDiffWrapLinesChange(checked === true)}
				closeOnSelect={false}
				data-testid="review-dialog-toggle-wrapping"
			>
				<HugeiconsIcon name="diff-wrapping" class="size-3" />
				Wrapping
			</DropdownMenu.CheckboxItem>
			<DropdownMenu.CheckboxItem
				checked={diffOptions.showLineNumbers}
				onCheckedChange={(checked) => onDiffShowLineNumbersChange(checked === true)}
				closeOnSelect={false}
				data-testid="review-dialog-toggle-line-numbers"
			>
				<HugeiconsIcon name="diff-line-numbers" class="size-3" />
				Line Numbers
			</DropdownMenu.CheckboxItem>
		</DropdownMenu.Group>
	</DropdownMenu.Content>
</DropdownMenu.Root>
