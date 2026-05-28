use crate::acp::transcript_viewport::layout::{HeightConfirmationOutcome, LayoutIndex};
use serde::{Deserialize, Serialize};

pub const DEFAULT_OVERSCAN_ROWS: usize = 4;

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
            viewport_height_px,
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

    pub fn resize(&mut self, viewport_height_px: u32) -> ViewportWindow {
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
        let outcome = self
            .layout
            .confirm_height(row_id, version, confirmed_height_px);
        self.repair_detached_anchor();
        self.bump_viewport_revision();

        ViewportTransition {
            window: self.window(),
            height_confirmation: Some(outcome),
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

#[cfg(test)]
mod tests {
    use super::{ScrollIntent, TranscriptViewport, ViewportMode};
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
}
