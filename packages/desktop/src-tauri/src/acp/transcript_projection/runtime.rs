use crate::acp::session::delivery::live_transcript_fold::transcript_delta_operations_for_event;
use crate::acp::session::ingress::event::ProviderEvent;
use crate::acp::session_state_engine::runtime_registry::ProviderEventTransition;
use crate::acp::transcript_projection::delta::{TranscriptDelta, TranscriptDeltaOperation};
use crate::acp::transcript_projection::display_id::{
    assistant_boundary_entry_count_from_transcript_entries, tool_call_id_from_authority_entry_id,
};
use crate::acp::transcript_projection::snapshot::{
    TranscriptEntry, TranscriptEntryRole, TranscriptSegment, TranscriptSnapshot,
};
use dashmap::DashMap;
use std::collections::HashMap;
use std::sync::Arc;

#[derive(Debug, Clone, Default)]
pub struct TranscriptProjectionRegistry {
    sessions: Arc<DashMap<String, SessionTranscriptProjection>>,
}

#[derive(Debug, Clone)]
pub(crate) struct TranscriptEntryProjectionSlice {
    pub(crate) revision: i64,
    pub(crate) total_entry_count: usize,
    pub(crate) entries: Vec<IndexedTranscriptEntry>,
}

#[derive(Debug, Clone)]
pub(crate) struct IndexedTranscriptEntry {
    pub(crate) index: usize,
    pub(crate) entry: TranscriptEntry,
}

impl TranscriptProjectionRegistry {
    #[must_use]
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(DashMap::new()),
        }
    }

    pub fn restore_session_snapshot(&self, session_id: String, snapshot: TranscriptSnapshot) {
        self.sessions.insert(
            session_id,
            SessionTranscriptProjection::from_snapshot(snapshot),
        );
    }

    pub fn remove_session(&self, session_id: &str) {
        self.sessions.remove(session_id);
    }

    #[must_use]
    pub fn snapshot_for_session(&self, session_id: &str) -> Option<TranscriptSnapshot> {
        self.sessions.get(session_id).map(|entry| entry.snapshot())
    }

    #[must_use]
    pub fn compact_snapshot_for_session(&self, session_id: &str) -> Option<TranscriptSnapshot> {
        self.sessions
            .get(session_id)
            .map(|entry| entry.compact_snapshot())
    }

    #[must_use]
    pub(crate) fn entry_slice_for_session(
        &self,
        session_id: &str,
        entry_ids: &[String],
    ) -> Option<TranscriptEntryProjectionSlice> {
        self.sessions
            .get(session_id)
            .map(|entry| entry.entry_slice(entry_ids))
    }

    #[must_use]
    pub(crate) fn entry_suffix_for_session(
        &self,
        session_id: &str,
        start_index: usize,
    ) -> Option<TranscriptEntryProjectionSlice> {
        self.sessions
            .get(session_id)
            .map(|entry| entry.entry_suffix(start_index))
    }

    #[must_use]
    pub fn apply_delta(&self, delta: &TranscriptDelta) -> TranscriptSnapshot {
        let mut session = self.sessions.entry(delta.session_id.clone()).or_default();
        session.apply_delta(delta);
        session.snapshot()
    }

    /// Mirrors an atomic held-graph provider-event transition into this
    /// registry's projection without refolding provider data.
    ///
    /// Duplicate events (`transition.applied == false`) are a no-op: `None`
    /// is returned and the projection is left unchanged. Otherwise the
    /// projection's transcript snapshot is unconditionally replaced with
    /// `transition.after` — even when the derived operations are empty —
    /// so the mirrored projection never diverges from the canonical held
    /// graph. A `TranscriptDelta` is only returned when the event-aware
    /// operations derived from `transition.before`/`transition.after` are
    /// non-empty.
    ///
    /// This path never reconstructs or folds a graph: it is a pure mirror of
    /// the already-folded transition.
    #[must_use]
    pub(crate) fn mirror_provider_event_transition(
        &self,
        event_seq: i64,
        event: &ProviderEvent,
        transition: &ProviderEventTransition,
    ) -> Option<TranscriptDelta> {
        if !transition.applied {
            return None;
        }
        if transition.before.transcript_snapshot == transition.after.transcript_snapshot {
            return None;
        }
        let session_id = transition.after.canonical_session_id.clone();
        let operations = transcript_delta_operations_for_event(
            event,
            &transition.before.transcript_snapshot,
            &transition.after.transcript_snapshot,
        );
        let mut session = self.sessions.entry(session_id.clone()).or_default();
        let snapshot_revision = session.mirror_from_transition(event_seq, &transition.after);
        drop(session);
        if operations.is_empty() {
            return None;
        }
        Some(TranscriptDelta {
            event_seq,
            session_id,
            snapshot_revision,
            operations,
        })
    }
}

#[derive(Debug, Clone)]
struct SessionTranscriptProjection {
    revision: i64,
    entries: Vec<TranscriptEntry>,
    entry_indexes: HashMap<String, usize>,
    tool_entry_ids_by_tool_call_id: HashMap<String, String>,
    assistant_boundary_entry_count: usize,
}

impl SessionTranscriptProjection {
    fn from_snapshot(snapshot: TranscriptSnapshot) -> Self {
        let mut entry_indexes = HashMap::new();
        for (index, entry) in snapshot.entries.iter().enumerate() {
            entry_indexes.insert(entry.entry_id.clone(), index);
        }
        let entries = snapshot.entries;
        Self {
            revision: snapshot.revision,
            entries: entries.clone(),
            entry_indexes,
            tool_entry_ids_by_tool_call_id: rebuild_tool_entry_ids_by_tool_call_id(&entries),
            assistant_boundary_entry_count: assistant_boundary_entry_count_from_transcript_entries(
                &entries,
            ),
        }
    }

    fn snapshot(&self) -> TranscriptSnapshot {
        TranscriptSnapshot {
            revision: self.revision,
            entries: self.entries.clone(),
        }
    }

    fn compact_snapshot(&self) -> TranscriptSnapshot {
        TranscriptSnapshot {
            revision: self.revision,
            entries: Vec::new(),
        }
    }

    fn entry_slice(&self, entry_ids: &[String]) -> TranscriptEntryProjectionSlice {
        let mut entries = Vec::new();
        for entry_id in entry_ids {
            let Some(index) = self.entry_indexes.get(entry_id).copied() else {
                continue;
            };
            if entries
                .iter()
                .any(|entry: &IndexedTranscriptEntry| entry.index == index)
            {
                continue;
            }
            entries.push(IndexedTranscriptEntry {
                index,
                entry: self.entries[index].clone(),
            });
        }
        entries.sort_by_key(|entry| entry.index);

        TranscriptEntryProjectionSlice {
            revision: self.revision,
            total_entry_count: self.entries.len(),
            entries,
        }
    }

    fn entry_suffix(&self, start_index: usize) -> TranscriptEntryProjectionSlice {
        let start_index = start_index.min(self.entries.len());
        let entries = self.entries[start_index..]
            .iter()
            .enumerate()
            .map(|(offset, entry)| IndexedTranscriptEntry {
                index: start_index.saturating_add(offset),
                entry: entry.clone(),
            })
            .collect();

        TranscriptEntryProjectionSlice {
            revision: self.revision,
            total_entry_count: self.entries.len(),
            entries,
        }
    }

    fn apply_delta(&mut self, delta: &TranscriptDelta) {
        self.revision = delta.snapshot_revision;
        for operation in &delta.operations {
            match operation {
                TranscriptDeltaOperation::AppendEntry { entry } => {
                    let closes_assistant_boundary = entry_closes_assistant_boundary(entry);
                    self.upsert_transcript_entry(delta.event_seq, entry.clone());
                    if closes_assistant_boundary {
                        self.close_assistant_entry_boundary();
                    }
                }
                TranscriptDeltaOperation::AppendSegment {
                    entry_id,
                    role,
                    segment,
                } => {
                    let closes_assistant_boundary = role_closes_assistant_boundary(role);
                    self.append_transcript_segment(
                        delta.event_seq,
                        entry_id.clone(),
                        role.clone(),
                        segment.clone(),
                    );
                    if closes_assistant_boundary {
                        self.close_assistant_entry_boundary();
                    }
                }
                TranscriptDeltaOperation::ReplaceSnapshot { snapshot } => {
                    *self = Self::from_snapshot(snapshot.clone());
                }
            }
        }
    }

    fn sync_entries_from_graph(
        &mut self,
        graph: &crate::acp::session_state_engine::graph::SessionStateGraph,
    ) {
        self.entries = graph.transcript_snapshot.entries.clone();
        self.entry_indexes.clear();
        for (index, entry) in self.entries.iter().enumerate() {
            self.entry_indexes.insert(entry.entry_id.clone(), index);
        }
        self.tool_entry_ids_by_tool_call_id = rebuild_tool_entry_ids_by_tool_call_id(&self.entries);
        self.assistant_boundary_entry_count =
            assistant_boundary_entry_count_from_transcript_entries(&self.entries);
    }

    /// Replaces this projection's compatibility snapshot with the held
    /// graph's transcript snapshot after a transition, without refolding.
    fn mirror_from_transition(
        &mut self,
        _event_seq: i64,
        graph: &crate::acp::session_state_engine::graph::SessionStateGraph,
    ) -> i64 {
        self.revision = graph.transcript_snapshot.revision;
        self.sync_entries_from_graph(graph);
        self.revision
    }

    fn upsert_transcript_entry(&mut self, _event_seq: i64, entry: TranscriptEntry) {
        self.upsert_entry(entry);
    }

    fn append_transcript_segment(
        &mut self,
        _event_seq: i64,
        entry_id: String,
        role: TranscriptEntryRole,
        segment: TranscriptSegment,
    ) {
        self.append_segment(entry_id, role, segment);
    }

    fn close_assistant_entry_boundary(&mut self) {
        self.assistant_boundary_entry_count = self.entries.len();
    }

    fn upsert_entry(&mut self, entry: TranscriptEntry) {
        if let Some(index) = self.entry_indexes.get(&entry.entry_id).copied() {
            self.entries[index] = entry;
            return;
        }
        let index = self.entries.len();
        self.entry_indexes.insert(entry.entry_id.clone(), index);
        self.entries.push(entry);
    }

    fn append_segment(
        &mut self,
        entry_id: String,
        role: TranscriptEntryRole,
        segment: TranscriptSegment,
    ) {
        if let Some(index) = self.entry_indexes.get(&entry_id).copied() {
            self.entries[index].segments.push(segment);
            return;
        }
        self.upsert_entry(TranscriptEntry {
            entry_id,
            role,
            segments: vec![segment],
            attempt_id: None,
            timestamp_ms: None,
        });
    }
}

impl Default for SessionTranscriptProjection {
    fn default() -> Self {
        Self {
            revision: 0,
            entries: Vec::new(),
            entry_indexes: HashMap::new(),
            tool_entry_ids_by_tool_call_id: HashMap::new(),
            assistant_boundary_entry_count: 0,
        }
    }
}

fn rebuild_tool_entry_ids_by_tool_call_id(entries: &[TranscriptEntry]) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for entry in entries {
        if entry.role != TranscriptEntryRole::Tool {
            continue;
        }
        let Some(tool_call_id) = tool_call_id_from_authority_entry_id(&entry.entry_id) else {
            continue;
        };
        map.insert(tool_call_id.clone(), entry.entry_id.clone());
    }
    map
}

fn entry_closes_assistant_boundary(entry: &TranscriptEntry) -> bool {
    role_closes_assistant_boundary(&entry.role)
}

fn role_closes_assistant_boundary(role: &TranscriptEntryRole) -> bool {
    !matches!(role, TranscriptEntryRole::Assistant)
}
