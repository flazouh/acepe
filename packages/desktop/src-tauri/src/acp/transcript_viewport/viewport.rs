use crate::acp::transcript_viewport::layout::{HeightConfirmationOutcome, LayoutIndex};
use serde::{Deserialize, Serialize};

pub const DEFAULT_OVERSCAN_ROWS: usize = 4;

/// Rows of overscan included on each side of the visible range when building a
/// buffer push. Large enough that the WebView can resolve a screen or two of
/// scrolling locally (zero IPC) before it must request a refill.
pub const DEFAULT_BUFFER_OVERSCAN_ROWS: usize = 50;
const MIN_VIEWPORT_HEIGHT_PX: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ViewportMode {
    FollowingTail,
    #[serde(rename_all = "camelCase")]
    Detached {
        anchor_row_id: String,
        offset_from_anchor_px: i64,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ViewportWindow {
    pub offset_px: u64,
    pub total_height_px: u64,
    pub visible_start_index: usize,
    pub visible_end_index: usize,
    pub mode: ViewportMode,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ScrollIntent {
    FollowTail,
    DetachAtOffset { offset_px: u64 },
    RevealRow { row_id: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ViewportTransition {
    pub window: ViewportWindow,
    pub height_confirmation: Option<HeightConfirmationOutcome>,
    /// Signed shift of the canonical scroll anchor caused by an accepted height
    /// confirmation. Positive when content at/above the current viewport offset
    /// grew (pushing the anchor down), negative when it shrank, `0` when the
    /// confirmation changed nothing at/above the viewport or was rejected.
    ///
    /// This is the relative correction the frontend applies additively to its
    /// live `scrollTop` so the viewport stays pinned to the same content while a
    /// row above it re-measures — instead of an absolute reposition that would
    /// fight the user's in-flight scroll (the scroll "storm").
    pub anchor_correction_px: i64,
}

/// Owned description of a buffered layout slice for a `ViewportBufferPush`.
/// `offsets_px[i]` is the absolute pixel offset of the row at
/// `buffer_start_index + i`. The end index is exclusive. Produced while holding
/// the viewport lock but fully owned so payload construction needs no lock.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ViewportBufferSlice {
    pub buffer_start_index: usize,
    pub buffer_end_index: usize,
    pub layout_row_count: usize,
    pub offsets_px: Vec<u64>,
    pub total_height_px: u64,
    pub buffer_end_offset_px: u64,
    pub viewport_offset_px: u64,
    pub mode: ViewportMode,
    pub viewport_revision: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TranscriptViewport {
    layout: LayoutIndex,
    mode: ViewportMode,
    viewport_height_px: u32,
    overscan_rows: usize,
    viewport_revision: i64,
}

impl TranscriptViewport {
    #[must_use]
    pub fn new(layout: LayoutIndex, viewport_height_px: u32) -> Self {
        Self {
            layout,
            mode: ViewportMode::FollowingTail,
            viewport_height_px: normalize_viewport_height_px(viewport_height_px),
            overscan_rows: DEFAULT_OVERSCAN_ROWS,
            viewport_revision: 1,
        }
    }

    #[must_use]
    pub fn with_viewport_revision(mut self, viewport_revision: i64) -> Self {
        self.viewport_revision = viewport_revision.max(1);
        self
    }

    #[must_use]
    pub fn with_overscan(mut self, overscan_rows: usize) -> Self {
        self.overscan_rows = overscan_rows;
        self
    }

    #[must_use]
    pub fn layout(&self) -> &LayoutIndex {
        &self.layout
    }

    #[must_use]
    pub fn mode(&self) -> &ViewportMode {
        &self.mode
    }

    #[must_use]
    pub fn viewport_revision(&self) -> i64 {
        self.viewport_revision
    }

    #[must_use]
    pub fn window(&self) -> ViewportWindow {
        let offset_px = self.current_offset_px();
        let range =
            self.layout
                .visible_range(offset_px, self.viewport_height_px, self.overscan_rows);

        ViewportWindow {
            offset_px,
            total_height_px: self.layout.total_height_px(),
            visible_start_index: range.start,
            visible_end_index: range.end,
            mode: self.mode.clone(),
        }
    }

    /// Build a buffered slice centred on the visible range with a large
    /// `buffer_overscan_rows` margin. The WebView resolves in-buffer scrolling
    /// locally and only requests a refill when nearing `[buffer_start_index,
    /// buffer_end_index)`.
    #[must_use]
    pub fn buffer_window(&self, buffer_overscan_rows: usize) -> ViewportBufferSlice {
        let offset_px = self.current_offset_px();
        let range =
            self.layout
                .visible_range(offset_px, self.viewport_height_px, buffer_overscan_rows);
        let offsets_px = (range.start..range.end)
            .map(|index| self.layout.offset_at_index(index))
            .collect();

        ViewportBufferSlice {
            buffer_start_index: range.start,
            buffer_end_index: range.end,
            layout_row_count: self.layout.row_count(),
            offsets_px,
            total_height_px: self.layout.total_height_px(),
            buffer_end_offset_px: self.layout.offset_at_index(range.end),
            viewport_offset_px: offset_px,
            mode: self.mode.clone(),
            viewport_revision: self.viewport_revision,
        }
    }

    pub fn resize(&mut self, viewport_height_px: u32) -> ViewportWindow {
        let viewport_height_px = normalize_viewport_height_px(viewport_height_px);
        if self.viewport_height_px != viewport_height_px {
            self.bump_viewport_revision();
        }
        self.viewport_height_px = viewport_height_px;
        self.window()
    }

    pub fn apply_scroll_intent(&mut self, intent: ScrollIntent) -> ViewportWindow {
        let previous_mode = self.mode.clone();
        match intent {
            ScrollIntent::FollowTail => {
                self.mode = ViewportMode::FollowingTail;
            }
            ScrollIntent::DetachAtOffset { offset_px } => {
                self.detach_at_offset(offset_px);
            }
            ScrollIntent::RevealRow { row_id } => {
                if self.layout.row(&row_id).is_some() {
                    self.mode = ViewportMode::Detached {
                        anchor_row_id: row_id,
                        offset_from_anchor_px: 0,
                    };
                }
            }
        }

        if self.mode != previous_mode {
            self.bump_viewport_revision();
        }
        self.window()
    }

    pub fn confirm_height(
        &mut self,
        row_id: &str,
        version: &str,
        confirmed_height_px: u32,
    ) -> ViewportTransition {
        // Capture the canonical scroll offset BEFORE the confirmation mutates
        // layout. The post-confirmation delta of this anchor-based offset is the
        // relative correction the frontend needs: it is non-zero only when the
        // confirmed row sits at/above the current viewport anchor.
        let offset_before = self.current_offset_px();
        let outcome = self
            .layout
            .confirm_height(row_id, version, confirmed_height_px);
        self.repair_detached_anchor();
        // Only an accepted confirmation changes layout geometry. A rejected
        // (stale-version / missing-row) confirmation changes nothing, so the
        // canonical viewport_revision must NOT advance — otherwise the buffer
        // producer's revision guard would treat each rejected retry as a layout
        // change and emit a full re-push, recreating the retry storm.
        let anchor_correction_px = if outcome == HeightConfirmationOutcome::Accepted {
            self.bump_viewport_revision();
            let offset_after = self.current_offset_px();
            i64::try_from(offset_after).unwrap_or(i64::MAX)
                - i64::try_from(offset_before).unwrap_or(i64::MAX)
        } else {
            0
        };

        ViewportTransition {
            window: self.window(),
            height_confirmation: Some(outcome),
            anchor_correction_px,
        }
    }

    pub fn replace_layout_preserving_viewport(&mut self, layout: LayoutIndex) -> ViewportWindow {
        self.layout = layout;
        self.repair_detached_anchor();
        self.window()
    }

    fn bump_viewport_revision(&mut self) {
        self.viewport_revision = self.viewport_revision.saturating_add(1);
    }

    fn current_offset_px(&self) -> u64 {
        match &self.mode {
            ViewportMode::FollowingTail => self
                .layout
                .total_height_px()
                .saturating_sub(u64::from(self.viewport_height_px)),
            ViewportMode::Detached {
                anchor_row_id,
                offset_from_anchor_px,
            } => {
                let anchor_offset = self.layout.row_offset_px(anchor_row_id).unwrap_or(0);
                if *offset_from_anchor_px >= 0 {
                    anchor_offset.saturating_add(*offset_from_anchor_px as u64)
                } else {
                    anchor_offset.saturating_sub(offset_from_anchor_px.unsigned_abs())
                }
            }
        }
    }

    fn detach_at_offset(&mut self, offset_px: u64) {
        let Some(anchor_row) = self.layout.row_at_offset(offset_px) else {
            self.mode = ViewportMode::FollowingTail;
            return;
        };
        let Some(anchor_offset) = self.layout.row_offset_px(&anchor_row.row_id) else {
            self.mode = ViewportMode::FollowingTail;
            return;
        };
        let offset_from_anchor_px = offset_px.saturating_sub(anchor_offset) as i64;
        self.mode = ViewportMode::Detached {
            anchor_row_id: anchor_row.row_id.clone(),
            offset_from_anchor_px,
        };
    }

    fn repair_detached_anchor(&mut self) {
        let ViewportMode::Detached {
            anchor_row_id,
            offset_from_anchor_px,
        } = &self.mode
        else {
            return;
        };
        if self.layout.row(anchor_row_id).is_some() {
            return;
        }

        if let Some(new_anchor_row_id) = self.layout.nearest_anchor_row_id(anchor_row_id) {
            self.mode = ViewportMode::Detached {
                anchor_row_id: new_anchor_row_id,
                offset_from_anchor_px: *offset_from_anchor_px,
            };
            return;
        }

        self.mode = ViewportMode::FollowingTail;
    }
}

fn normalize_viewport_height_px(viewport_height_px: u32) -> u32 {
    viewport_height_px.max(MIN_VIEWPORT_HEIGHT_PX)
}

#[cfg(test)]
mod tests {
    use super::{ScrollIntent, TranscriptViewport, ViewportMode, DEFAULT_BUFFER_OVERSCAN_ROWS};
    use crate::acp::transcript_viewport::layout::{
        HeightConfirmationOutcome, LayoutIndex, RowLayout,
    };

    fn row(row_id: &str, height: u32) -> RowLayout {
        RowLayout {
            row_id: row_id.to_string(),
            version: format!("{row_id}:v1"),
            estimated_height_px: height,
            confirmed_height_px: None,
            anchor_eligible: true,
        }
    }

    #[test]
    fn following_tail_window_ends_at_tail() {
        let viewport = TranscriptViewport::new(
            LayoutIndex::new(vec![
                row("row-1", 100),
                row("row-2", 100),
                row("row-3", 100),
            ]),
            100,
        )
        .with_overscan(0);

        let window = viewport.window();

        assert_eq!(window.offset_px, 200);
        assert_eq!(window.visible_start_index, 2);
        assert_eq!(window.visible_end_index, 3);
        assert_eq!(window.mode, ViewportMode::FollowingTail);
    }

    #[test]
    fn explicit_reveal_tail_reenters_follow_mode() {
        let mut viewport = TranscriptViewport::new(
            LayoutIndex::new(vec![
                row("row-1", 100),
                row("row-2", 100),
                row("row-3", 100),
            ]),
            100,
        );
        viewport.apply_scroll_intent(ScrollIntent::DetachAtOffset { offset_px: 50 });

        let window = viewport.apply_scroll_intent(ScrollIntent::FollowTail);

        assert_eq!(window.mode, ViewportMode::FollowingTail);
        assert_eq!(window.offset_px, 200);
    }

    #[test]
    fn detached_anchor_survives_insertions_before_anchor() {
        let mut viewport = TranscriptViewport::new(
            LayoutIndex::new(vec![row("row-1", 100), row("row-2", 100)]),
            100,
        );
        viewport.apply_scroll_intent(ScrollIntent::DetachAtOffset { offset_px: 120 });

        let window = viewport.replace_layout_preserving_viewport(LayoutIndex::new(vec![
            row("inserted", 50),
            row("row-1", 100),
            row("row-2", 100),
        ]));

        assert_eq!(
            window.mode,
            ViewportMode::Detached {
                anchor_row_id: "row-2".to_string(),
                offset_from_anchor_px: 20,
            }
        );
        assert_eq!(window.offset_px, 170);
    }

    #[test]
    fn removed_anchor_chooses_nearest_surviving_anchor_without_revealing_tail() {
        let mut viewport = TranscriptViewport::new(
            LayoutIndex::new(vec![
                row("row-1", 100),
                row("row-2", 100),
                row("row-3", 100),
            ]),
            100,
        );
        viewport.apply_scroll_intent(ScrollIntent::RevealRow {
            row_id: "row-2".to_string(),
        });

        let window = viewport.replace_layout_preserving_viewport(LayoutIndex::new(vec![
            row("row-1", 100),
            row("row-3", 100),
        ]));

        assert_eq!(
            window.mode,
            ViewportMode::Detached {
                anchor_row_id: "row-3".to_string(),
                offset_from_anchor_px: 0,
            }
        );
    }

    #[test]
    fn confirm_height_reports_anchor_correction_for_row_above_viewport() {
        let mut viewport = TranscriptViewport::new(
            LayoutIndex::new(vec![
                row("row-1", 100),
                row("row-2", 100),
                row("row-3", 100),
            ]),
            100,
        );
        // Anchor at row-3 (offset 200); row-1 sits above the viewport.
        viewport.apply_scroll_intent(ScrollIntent::RevealRow {
            row_id: "row-3".to_string(),
        });

        // row-1 grows 100 -> 160 (+60) -> anchor (and visible content) shifts +60.
        let transition = viewport.confirm_height("row-1", "row-1:v1", 160);

        assert_eq!(
            transition.height_confirmation,
            Some(HeightConfirmationOutcome::Accepted)
        );
        assert_eq!(transition.anchor_correction_px, 60);
        assert_eq!(transition.window.offset_px, 260);
    }

    #[test]
    fn confirm_height_reports_zero_correction_for_row_at_or_below_viewport() {
        let mut viewport = TranscriptViewport::new(
            LayoutIndex::new(vec![
                row("row-1", 100),
                row("row-2", 100),
                row("row-3", 100),
            ]),
            100,
        );
        // Anchor at row-1 (offset 0); row-2 sits below the viewport top.
        viewport.apply_scroll_intent(ScrollIntent::RevealRow {
            row_id: "row-1".to_string(),
        });

        let transition = viewport.confirm_height("row-2", "row-2:v1", 160);

        assert_eq!(
            transition.height_confirmation,
            Some(HeightConfirmationOutcome::Accepted)
        );
        assert_eq!(transition.anchor_correction_px, 0);
        assert_eq!(transition.window.offset_px, 0);
    }

    #[test]
    fn confirm_height_reports_negative_correction_when_row_above_shrinks() {
        let mut viewport = TranscriptViewport::new(
            LayoutIndex::new(vec![row("row-1", 200), row("row-2", 100)]),
            100,
        );
        viewport.apply_scroll_intent(ScrollIntent::RevealRow {
            row_id: "row-2".to_string(),
        });

        // row-1 shrinks 200 -> 140 (-60).
        let transition = viewport.confirm_height("row-1", "row-1:v1", 140);

        assert_eq!(transition.anchor_correction_px, -60);
    }

    #[test]
    fn rejected_confirmation_reports_zero_anchor_correction() {
        let mut viewport = TranscriptViewport::new(
            LayoutIndex::new(vec![row("row-1", 100), row("row-2", 100)]),
            100,
        );
        viewport.apply_scroll_intent(ScrollIntent::RevealRow {
            row_id: "row-2".to_string(),
        });

        let transition = viewport.confirm_height("row-1", "row-1:vWRONG", 160);

        assert_eq!(
            transition.height_confirmation,
            Some(HeightConfirmationOutcome::StaleVersion)
        );
        assert_eq!(transition.anchor_correction_px, 0);
    }

    #[test]
    fn height_correction_preserves_detached_anchor_position() {
        let mut viewport = TranscriptViewport::new(
            LayoutIndex::new(vec![row("row-1", 100), row("row-2", 100)]),
            100,
        );
        viewport.apply_scroll_intent(ScrollIntent::RevealRow {
            row_id: "row-2".to_string(),
        });

        let transition = viewport.confirm_height("row-1", "row-1:v1", 150);

        assert_eq!(
            transition.height_confirmation,
            Some(HeightConfirmationOutcome::Accepted)
        );
        assert_eq!(transition.window.offset_px, 150);
        assert_eq!(
            transition.window.mode,
            ViewportMode::Detached {
                anchor_row_id: "row-2".to_string(),
                offset_from_anchor_px: 0,
            }
        );
    }

    #[test]
    fn viewport_revision_advances_for_viewport_only_updates() {
        let mut viewport = TranscriptViewport::new(
            LayoutIndex::new(vec![row("row-1", 100), row("row-2", 100)]),
            100,
        )
        .with_viewport_revision(10);

        assert_eq!(viewport.viewport_revision(), 10);

        viewport.confirm_height("row-1", "row-1:v1", 150);
        assert_eq!(viewport.viewport_revision(), 11);

        viewport.apply_scroll_intent(ScrollIntent::DetachAtOffset { offset_px: 125 });
        assert_eq!(viewport.viewport_revision(), 12);

        viewport.resize(140);
        assert_eq!(viewport.viewport_revision(), 13);
    }

    #[test]
    fn stale_height_confirmation_does_not_change_layout() {
        let mut viewport = TranscriptViewport::new(
            LayoutIndex::new(vec![row("row-1", 100), row("row-2", 100)]),
            100,
        );

        let transition = viewport.confirm_height("row-1", "row-1:v0", 150);

        assert_eq!(
            transition.height_confirmation,
            Some(HeightConfirmationOutcome::StaleVersion)
        );
        assert_eq!(transition.window.total_height_px, 200);
    }

    #[test]
    fn buffer_window_following_tail_extends_overscan_back_from_tail() {
        let viewport = TranscriptViewport::new(
            LayoutIndex::new(vec![
                row("row-1", 100),
                row("row-2", 100),
                row("row-3", 100),
                row("row-4", 100),
                row("row-5", 100),
            ]),
            100,
        )
        .with_overscan(0);

        let slice = viewport.buffer_window(2);

        assert_eq!(slice.buffer_start_index, 2);
        assert_eq!(slice.buffer_end_index, 5);
        assert_eq!(slice.layout_row_count, 5);
        assert_eq!(slice.offsets_px, vec![200, 300, 400]);
        assert_eq!(slice.total_height_px, 500);
        assert_eq!(slice.buffer_end_offset_px, 500);
        assert_eq!(slice.viewport_offset_px, 400);
        assert_eq!(slice.mode, ViewportMode::FollowingTail);
    }

    #[test]
    fn buffer_window_clamps_overscan_to_layout_bounds() {
        let viewport = TranscriptViewport::new(
            LayoutIndex::new(vec![
                row("row-1", 100),
                row("row-2", 100),
                row("row-3", 100),
            ]),
            100,
        )
        .with_overscan(0);

        let slice = viewport.buffer_window(1000);

        assert_eq!(slice.buffer_start_index, 0);
        assert_eq!(slice.buffer_end_index, 3);
        assert_eq!(slice.layout_row_count, 3);
        assert_eq!(slice.offsets_px, vec![0, 100, 200]);
        assert_eq!(slice.total_height_px, 300);
        assert_eq!(slice.buffer_end_offset_px, 300);
    }

    #[test]
    fn buffer_window_partial_bottom_reports_buffer_end_offset_below_total() {
        let mut viewport = TranscriptViewport::new(
            LayoutIndex::new(vec![
                row("row-1", 100),
                row("row-2", 100),
                row("row-3", 100),
                row("row-4", 100),
                row("row-5", 100),
            ]),
            100,
        )
        .with_overscan(0);
        // Detach near the top so the buffer does NOT reach the layout end.
        viewport.apply_scroll_intent(ScrollIntent::DetachAtOffset { offset_px: 0 });

        let slice = viewport.buffer_window(1);

        assert_eq!(slice.buffer_start_index, 0);
        assert_eq!(slice.buffer_end_index, 2);
        assert_eq!(slice.layout_row_count, 5);
        assert_eq!(slice.buffer_end_offset_px, 200);
        assert!(slice.buffer_end_offset_px < slice.total_height_px);
    }

    #[test]
    fn buffer_window_reflects_detached_offset_and_mode() {
        let mut viewport = TranscriptViewport::new(
            LayoutIndex::new(vec![
                row("row-1", 100),
                row("row-2", 100),
                row("row-3", 100),
                row("row-4", 100),
                row("row-5", 100),
            ]),
            100,
        )
        .with_overscan(0);
        viewport.apply_scroll_intent(ScrollIntent::DetachAtOffset { offset_px: 150 });

        let slice = viewport.buffer_window(1);

        assert_eq!(slice.viewport_offset_px, 150);
        assert_eq!(slice.buffer_start_index, 0);
        assert_eq!(slice.buffer_end_index, 4);
        assert_eq!(slice.offsets_px, vec![0, 100, 200, 300]);
        assert!(matches!(slice.mode, ViewportMode::Detached { .. }));
    }

    #[test]
    fn buffer_window_on_empty_layout_is_empty() {
        let viewport = TranscriptViewport::new(LayoutIndex::new(vec![]), 100);

        let slice = viewport.buffer_window(DEFAULT_BUFFER_OVERSCAN_ROWS);

        assert_eq!(slice.buffer_start_index, 0);
        assert_eq!(slice.buffer_end_index, 0);
        assert!(slice.offsets_px.is_empty());
        assert_eq!(slice.total_height_px, 0);
    }

    #[test]
    fn zero_height_viewport_still_buffers_non_empty_layout() {
        let viewport = TranscriptViewport::new(
            LayoutIndex::new(vec![
                row("row-1", 100),
                row("row-2", 100),
                row("row-3", 100),
            ]),
            0,
        );

        let slice = viewport.buffer_window(1);

        assert_eq!(slice.layout_row_count, 3);
        assert_eq!(slice.buffer_start_index, 1);
        assert_eq!(slice.buffer_end_index, 3);
        assert_eq!(slice.offsets_px, vec![100, 200]);
        assert_eq!(slice.viewport_offset_px, 299);
    }

    #[test]
    fn following_tail_survives_awaiting_to_assistant_swap() {
        let mut viewport = TranscriptViewport::new(
            LayoutIndex::new(vec![row("user-1", 60), row("awaiting:planning", 38)]),
            400,
        )
        .with_overscan(0);

        assert_eq!(viewport.mode(), &ViewportMode::FollowingTail);

        let layout_with_assistant =
            LayoutIndex::new(vec![row("user-1", 60), row("assistant-1", 120)]);
        viewport.replace_layout_preserving_viewport(layout_with_assistant);

        assert_eq!(viewport.mode(), &ViewportMode::FollowingTail);
        let window = viewport.window();
        assert_eq!(window.offset_px, 0);
        assert_eq!(window.total_height_px, 180);
    }

    #[test]
    fn detached_viewport_reattaches_to_nearest_row_on_awaiting_swap() {
        let mut viewport = TranscriptViewport::new(
            LayoutIndex::new(vec![row("user-1", 60), row("awaiting:planning", 38)]),
            400,
        );
        viewport.apply_scroll_intent(ScrollIntent::DetachAtOffset { offset_px: 40 });

        assert_eq!(
            viewport.mode(),
            &ViewportMode::Detached {
                anchor_row_id: "user-1".to_string(),
                offset_from_anchor_px: 40,
            }
        );

        viewport.replace_layout_preserving_viewport(LayoutIndex::new(vec![
            row("user-1", 60),
            row("assistant-1", 120),
        ]));

        assert_eq!(
            viewport.mode(),
            &ViewportMode::Detached {
                anchor_row_id: "user-1".to_string(),
                offset_from_anchor_px: 40,
            }
        );
    }
}
