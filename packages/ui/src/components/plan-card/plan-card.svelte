<script lang="ts">
  /**
   * PlanCard — Inline plan preview for tool call cards.
   *
   * Purely presentational: no Tauri coupling. All behavior via callback props.
   * Used by both create_plan and exit_plan_mode tool call components.
  */
  import type { Snippet } from "svelte";
  import type { PlanCardStatus } from "./types.js";

  import { MarkdownDisplay } from "../markdown/index.js";
  import {
    EmbeddedPanelHeader,
    HeaderActionCell,
    HeaderTitleCell,
  } from "../panel-header/index.js";
  import { Button } from "../button/index.js";
  import { PlanIcon, BuildIcon, LoadingIcon, RoundedIcon } from "../icons/index.js";
  import { ArrowsOut } from "phosphor-svelte";

  interface Props {
    content: string;
    title?: string;
    status: PlanCardStatus;
    actionsDisabled?: boolean;
    onViewFull?: () => void;
    onBuild?: () => void;
    onCancel?: () => void;
    headerExtra?: Snippet;
    class?: string;
  }

  let {
    content,
    title = "Plan",
    status,
    actionsDisabled = false,
    onViewFull,
    onBuild,
    onCancel,
    headerExtra,
    class: className = "",
  }: Props = $props();

  const showDecisionActions = $derived(
    (status === "interactive" || status === "building") &&
      (onCancel !== undefined || onBuild !== undefined),
  );
  const isBuilding = $derived(status === "building");
</script>

<div
  class="plan-card rounded-lg border border-border bg-background/60 overflow-hidden {className}"
>
  <!-- Header -->
  <EmbeddedPanelHeader class="bg-accent/35">
    <HeaderTitleCell compactPadding>
      <PlanIcon size="sm" class="shrink-0 mr-1" />
      <span
        class="text-[11px] font-semibold font-mono text-foreground select-none leading-none"
      >
        {title}
      </span>
    </HeaderTitleCell>

    {#if headerExtra}
      {@render headerExtra()}
    {/if}

    {#if onViewFull}
      <HeaderActionCell>
        <button
          type="button"
          class="plan-open-btn"
          onclick={onViewFull}
          title="Open full plan"
          aria-label="Open full plan"
        >
          <ArrowsOut weight="bold" class="size-3.5 shrink-0" />
        </button>
      </HeaderActionCell>
    {/if}
  </EmbeddedPanelHeader>

  <!-- Plan preview (max height ~half of default for compact inline display) -->
  <div class="plan-preview plan-preview--compact">
    {#if content}
      <MarkdownDisplay {content} class="plan-markdown" />
    {:else}
      <div class="plan-skeleton">
        <div class="shimmer-line w-3/4"></div>
        <div class="shimmer-line w-1/2"></div>
        <div class="shimmer-line w-5/6"></div>
      </div>
    {/if}
  </div>

  {#if showDecisionActions}
    <div class="plan-footer">
      {#if onCancel}
        <Button
          type="button"
          variant="headerAction"
          size="headerAction"
          onclick={onCancel}
          disabled={actionsDisabled || isBuilding}
        >
          <RoundedIcon name="x-circle" class="size-3 shrink-0" />
          Cancel
        </Button>
      {/if}

      {#if onBuild}
        <Button
          type="button"
          variant="headerAction"
          size="headerAction"
          onclick={onBuild}
          disabled={actionsDisabled || isBuilding}
        >
          {#if isBuilding}
            <LoadingIcon size={12} />
            Building…
          {:else}
            <BuildIcon size="sm" />
            Build
          {/if}
        </Button>
      {/if}
    </div>
  {/if}

</div>

<style>
  .plan-preview {
    overflow-y: auto;
    background: color-mix(in srgb, var(--background) 82%, var(--accent) 18%);
  }

  .plan-preview--compact {
    max-height: 20rem;
  }

  .plan-preview :global(.plan-markdown) {
    font-size: 0.75rem;
    line-height: 1.5;
  }

  .plan-preview :global(.plan-markdown .markdown-content) {
    padding: 8px 12px;
  }

  .plan-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
    padding: 6px;
    border-top: 1px solid var(--border);
    background: color-mix(in srgb, var(--background) 76%, var(--accent) 24%);
  }

  .plan-open-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0 8px;
    height: 100%;
    color: var(--muted-foreground);
    background: transparent;
    border: none;
    cursor: pointer;
    transition:
      color 0.15s ease,
      background-color 0.15s ease;
  }

  .plan-open-btn:hover {
    color: var(--foreground);
    background: color-mix(in srgb, var(--accent) 50%, transparent);
  }

  .plan-skeleton {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .shimmer-line {
    height: 10px;
    border-radius: 4px;
    background: linear-gradient(
      90deg,
      var(--muted) 25%,
      color-mix(in srgb, var(--muted) 70%, transparent) 50%,
      var(--muted) 75%
    );
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
  }

  @keyframes shimmer {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -200% 0;
    }
  }

</style>
