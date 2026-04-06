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
  import { PlanIcon, BuildIcon, LoadingIcon } from "../icons/index.js";
  import { XCircle } from "phosphor-svelte";
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

  const showBuild = $derived(status === "interactive");
  const showActions = $derived(status !== "rejected");
  const isBuilding = $derived(status === "building");
  const disabled = $derived(actionsDisabled || status === "streaming");
</script>

<div
  class="plan-card rounded-md border border-border bg-accent/50 overflow-hidden {className}"
>
  <!-- Header -->
  <EmbeddedPanelHeader class="bg-accent/50">
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
          class="plan-action-btn"
          onclick={onViewFull}
          title="Open full screen"
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

  <!-- Footer actions -->
  {#if showActions}
    <div class="plan-footer">
      <div class="plan-footer-right">
        {#if showBuild && onCancel}
          <button
            type="button"
            class="plan-footer-btn plan-footer-btn--cancel"
            onclick={onCancel}
            disabled={isBuilding}
          >
            <XCircle weight="fill" class="size-3 shrink-0" />
            Cancel
          </button>
        {/if}

        {#if showBuild && onBuild}
          <button
            type="button"
            class="plan-footer-btn plan-footer-btn--build"
            onclick={onBuild}
            disabled={isBuilding}
          >
            {#if isBuilding}
              <LoadingIcon class="size-3" />
              Building…
            {:else}
              <BuildIcon size="sm" />
              Build
            {/if}
          </button>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .plan-preview {
    overflow-y: auto;
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
    gap: 1px;
    border-top: 1px solid var(--border);
    background: color-mix(in srgb, var(--accent) 50%, transparent);
  }

  .plan-footer-right {
    display: flex;
    align-items: center;
    gap: 1px;
  }

  .plan-footer-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 4px 8px;
    font: inherit;
    font-size: 0.625rem;
    font-weight: 500;
    font-family: var(--font-mono, ui-monospace, monospace);
    color: var(--muted-foreground);
    background: transparent;
    border: none;
    cursor: pointer;
    transition:
      color 0.15s ease,
      background-color 0.15s ease;
  }

  .plan-footer-btn:hover:not(:disabled) {
    color: var(--foreground);
    background: color-mix(in srgb, var(--accent) 50%, transparent);
  }

  .plan-footer-btn:disabled {
    opacity: 0.4;
    pointer-events: none;
  }

  .plan-action-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0 8px;
    height: 100%;
    font: inherit;
    font-size: 0.625rem;
    font-weight: 500;
    font-family: var(--font-mono, ui-monospace, monospace);
    color: var(--muted-foreground);
    background: transparent;
    border: none;
    cursor: pointer;
    transition:
      color 0.15s ease,
      background-color 0.15s ease;
  }

  .plan-action-btn:hover {
    color: var(--foreground);
    background: color-mix(in srgb, var(--accent) 50%, transparent);
  }

  .plan-action-btn:disabled {
    opacity: 0.5;
    pointer-events: none;
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
