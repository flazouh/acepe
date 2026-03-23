<script lang="ts">
  /**
   * PlanCard — Inline plan preview for tool call cards.
   *
   * Purely presentational: no Tauri coupling. All behavior via callback props.
   * Used by both create_plan and exit_plan_mode tool call components.
   */
  import type { Snippet } from "svelte";

  import { MarkdownDisplay } from "../markdown/index.js";
  import {
    EmbeddedPanelHeader,
    HeaderActionCell,
    HeaderTitleCell,
  } from "../panel-header/index.js";
  import { PlanIcon, BuildIcon, LoadingIcon } from "../icons/index.js";
  import XCircle from "phosphor-svelte/lib/XCircle";
  import ArrowsOut from "phosphor-svelte/lib/ArrowsOut";
  import ArrowSquareOut from "phosphor-svelte/lib/ArrowSquareOut";
  import MagnifyingGlass from "phosphor-svelte/lib/MagnifyingGlass";
  import Lightning from "phosphor-svelte/lib/Lightning";
  import DownloadSimple from "phosphor-svelte/lib/DownloadSimple";

  export type PlanCardStatus =
    | "streaming"
    | "interactive"
    | "approved"
    | "rejected"
    | "building";

  interface Props {
    content: string;
    title?: string;
    status: PlanCardStatus;
    actionsDisabled?: boolean;
    /** Whether skills (Review/Deepen) are missing and need to be installed */
    skillsMissing?: boolean;
    /** GitHub repo URLs for skills (shown as links when skills are missing) */
    reviewRepoUrl?: string;
    deepenRepoUrl?: string;
    onInstallSkills?: () => void;
    onViewFull?: () => void;
    onBuild?: () => void;
    onCancel?: () => void;
    onReview?: () => void;
    onDeepen?: () => void;
    headerExtra?: Snippet;
    class?: string;
  }

  let {
    content,
    title = "Plan",
    status,
    actionsDisabled = false,
    skillsMissing = false,
    reviewRepoUrl,
    deepenRepoUrl,
    onInstallSkills,
    onViewFull,
    onBuild,
    onCancel,
    onReview,
    onDeepen,
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
  <EmbeddedPanelHeader class="bg-accent/40">
    <HeaderTitleCell compactPadding>
      <PlanIcon
        size="sm"
        class="shrink-0 mr-1"
        style="color: var(--orange, #f59e0b)"
      />
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
      <div class="plan-footer-left">
        {#if skillsMissing && reviewRepoUrl}
          <a
            href={reviewRepoUrl}
            target="_blank"
            rel="noopener noreferrer"
            class="plan-footer-btn plan-footer-link"
            title="View Review skill on GitHub"
          >
            <MagnifyingGlass weight="bold" class="size-3 shrink-0" />
            Review
            <ArrowSquareOut weight="bold" class="size-2.5 shrink-0 opacity-50" />
          </a>
        {:else if onReview}
          <button
            type="button"
            class="plan-footer-btn"
            onclick={onReview}
            {disabled}
            title="Reject plan and run /ce:review"
          >
            <MagnifyingGlass weight="bold" class="size-3 shrink-0" />
            Review
          </button>
        {/if}

        {#if skillsMissing && deepenRepoUrl}
          <a
            href={deepenRepoUrl}
            target="_blank"
            rel="noopener noreferrer"
            class="plan-footer-btn plan-footer-link"
            title="View Deepen skill on GitHub"
          >
            <Lightning weight="fill" class="size-3 shrink-0" />
            Deepen
            <ArrowSquareOut weight="bold" class="size-2.5 shrink-0 opacity-50" />
          </a>
        {:else if onDeepen}
          <button
            type="button"
            class="plan-footer-btn"
            onclick={onDeepen}
            {disabled}
            title="Reject plan and run /deepen-plan"
          >
            <Lightning weight="fill" class="size-3 shrink-0" />
            Deepen
          </button>
        {/if}
      </div>

      <div class="plan-footer-right">
        {#if skillsMissing && onInstallSkills}
          <button
            type="button"
            class="plan-footer-btn plan-footer-btn--install"
            onclick={onInstallSkills}
            {disabled}
          >
            <DownloadSimple weight="bold" class="size-3 shrink-0" />
            Install skills
          </button>
        {/if}

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
    justify-content: space-between;
    gap: 1px;
    border-top: 1px solid var(--border);
    background: color-mix(in srgb, var(--accent) 30%, transparent);
  }

  .plan-footer-left,
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


  .plan-footer-link {
    text-decoration: none;
  }

  .plan-footer-link:hover {
    color: var(--foreground);
    background: color-mix(in srgb, var(--accent) 50%, transparent);
  }

  .plan-footer-link:hover :global(.opacity-50) {
    opacity: 1;
  }

  .plan-footer-btn--install {
    opacity: 0.6;
  }

  .plan-footer-btn--install:hover:not(:disabled) {
    color: var(--foreground);
    opacity: 1;
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
