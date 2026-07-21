use std::any::Any;
use std::collections::{HashMap, VecDeque};
use std::future::Future;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use futures::FutureExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tokio::sync::watch;
use uuid::Uuid;

use crate::acp::session::engine::fold::{fold_full, FoldContext};
use crate::acp::session_descriptor::SessionReplayContext;
use crate::acp::session_open_snapshot::SessionOpenError;
use crate::acp::session_state_engine::selectors::{
    SessionGraphCapabilities, SessionGraphLifecycle,
};
use crate::acp::transcript_viewport::ledger_rebuild::{
    rebuild_and_replace_current_transcript_row_ledger_from_journal,
    rebuild_and_replace_current_transcript_row_ledger_from_provider_snapshot,
    rebuild_and_replace_current_transcript_row_ledger_from_session_graph,
};
use sea_orm::DbConn;

use super::fold_provider_load::load_provider_history_events;
use super::provider_load::{
    load_provider_owned_session_snapshot, session_open_error_from_provider_load,
};

const DEFAULT_MAX_CONCURRENT_REPAIRS: usize = 2;
const COMPLETED_TICKET_TTL: Duration = Duration::from_secs(30);
const REPAIR_OPERATION_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum TranscriptRepairPriority {
    Selected,
    Visible,
    Backfill,
}

const FAIR_SCHEDULE: [TranscriptRepairPriority; 7] = [
    TranscriptRepairPriority::Selected,
    TranscriptRepairPriority::Selected,
    TranscriptRepairPriority::Selected,
    TranscriptRepairPriority::Selected,
    TranscriptRepairPriority::Visible,
    TranscriptRepairPriority::Visible,
    TranscriptRepairPriority::Backfill,
];

#[derive(Debug, Clone)]
pub struct TranscriptRepairRequest {
    pub replay_context: SessionReplayContext,
}

#[derive(Debug, Clone)]
enum RepairCompletion {
    Pending,
    Finished(Result<(), SessionOpenError>),
}

struct RepairJob {
    request: TranscriptRepairRequest,
    completion: watch::Sender<RepairCompletion>,
    completed_at: Arc<Mutex<Option<Instant>>>,
}

struct RepairTicket {
    request: TranscriptRepairRequest,
    completion: watch::Receiver<RepairCompletion>,
    completed_at: Arc<Mutex<Option<Instant>>>,
}

struct ActiveRepair {
    completion: watch::Sender<RepairCompletion>,
    completed_at: Arc<Mutex<Option<Instant>>>,
}

struct CoordinatorState {
    selected: VecDeque<RepairJob>,
    visible: VecDeque<RepairJob>,
    backfill: VecDeque<RepairJob>,
    active_sessions: HashMap<String, ActiveRepair>,
    tickets: HashMap<String, RepairTicket>,
    running: usize,
    fair_cursor: usize,
}

impl CoordinatorState {
    fn new() -> Self {
        Self {
            selected: VecDeque::new(),
            visible: VecDeque::new(),
            backfill: VecDeque::new(),
            active_sessions: HashMap::new(),
            tickets: HashMap::new(),
            running: 0,
            fair_cursor: 0,
        }
    }

    fn queue_mut(&mut self, priority: TranscriptRepairPriority) -> &mut VecDeque<RepairJob> {
        match priority {
            TranscriptRepairPriority::Selected => &mut self.selected,
            TranscriptRepairPriority::Visible => &mut self.visible,
            TranscriptRepairPriority::Backfill => &mut self.backfill,
        }
    }

    fn pop_fair(&mut self) -> Option<RepairJob> {
        for _ in 0..FAIR_SCHEDULE.len() {
            let priority = FAIR_SCHEDULE[self.fair_cursor];
            self.fair_cursor = (self.fair_cursor + 1) % FAIR_SCHEDULE.len();
            if let Some(job) = self.queue_mut(priority).pop_front() {
                return Some(job);
            }
        }
        None
    }

    fn promote_queued(&mut self, session_id: &str, priority: TranscriptRepairPriority) {
        for existing_priority in [
            TranscriptRepairPriority::Selected,
            TranscriptRepairPriority::Visible,
            TranscriptRepairPriority::Backfill,
        ] {
            if priority_rank(existing_priority) <= priority_rank(priority) {
                continue;
            }
            let position = self
                .queue_mut(existing_priority)
                .iter()
                .position(|job| job.request.replay_context.local_session_id == session_id);
            if let Some(position) = position {
                if let Some(job) = self.queue_mut(existing_priority).remove(position) {
                    self.queue_mut(priority).push_back(job);
                }
                return;
            }
        }
    }

    fn remove_expired_completed_tickets(&mut self) {
        let now = Instant::now();
        self.tickets.retain(|_, ticket| {
            let completed_at = *ticket
                .completed_at
                .lock()
                .expect("transcript repair completion timestamp lock");
            completed_at.is_none_or(|instant| now.duration_since(instant) < COMPLETED_TICKET_TTL)
        });
    }
}

pub struct TranscriptRepairCoordinator {
    state: Mutex<CoordinatorState>,
    max_concurrent_repairs: usize,
}

impl TranscriptRepairCoordinator {
    #[must_use]
    pub fn new() -> Arc<Self> {
        Self::with_max_concurrent_repairs(DEFAULT_MAX_CONCURRENT_REPAIRS)
    }

    #[must_use]
    pub fn with_max_concurrent_repairs(max_concurrent_repairs: usize) -> Arc<Self> {
        Arc::new(Self {
            state: Mutex::new(CoordinatorState::new()),
            max_concurrent_repairs: max_concurrent_repairs.max(1),
        })
    }

    #[allow(clippy::map_entry)] // Promotion must happen before borrowing the active repair.
    pub fn request(
        self: &Arc<Self>,
        app: AppHandle,
        request: TranscriptRepairRequest,
        priority: TranscriptRepairPriority,
    ) -> String {
        let session_id = request.replay_context.local_session_id.clone();
        let ticket_id = Uuid::new_v4().to_string();
        {
            let mut state = self
                .state
                .lock()
                .expect("transcript repair coordinator lock");
            state.remove_expired_completed_tickets();
            let (receiver, completed_at) = if state.active_sessions.contains_key(&session_id) {
                state.promote_queued(&session_id, priority);
                let active = state
                    .active_sessions
                    .get(&session_id)
                    .expect("active transcript repair");
                (
                    active.completion.subscribe(),
                    Arc::clone(&active.completed_at),
                )
            } else {
                let (completion, receiver) = watch::channel(RepairCompletion::Pending);
                let completed_at = Arc::new(Mutex::new(None));
                state.active_sessions.insert(
                    session_id,
                    ActiveRepair {
                        completion: completion.clone(),
                        completed_at: Arc::clone(&completed_at),
                    },
                );
                state.queue_mut(priority).push_back(RepairJob {
                    request: request.clone(),
                    completion,
                    completed_at: Arc::clone(&completed_at),
                });
                (receiver, completed_at)
            };
            state.tickets.insert(
                ticket_id.clone(),
                RepairTicket {
                    request,
                    completion: receiver,
                    completed_at,
                },
            );
        }
        self.dispatch(app);
        ticket_id
    }

    pub async fn await_ticket(
        &self,
        ticket_id: &str,
    ) -> Result<TranscriptRepairRequest, SessionOpenError> {
        let mut ticket = {
            let mut state = self
                .state
                .lock()
                .expect("transcript repair coordinator lock");
            state.remove_expired_completed_tickets();
            state.tickets.remove(ticket_id).ok_or_else(|| {
                SessionOpenError::internal("unknown", "Transcript repair ticket is unavailable")
            })?
        };
        loop {
            let completion = ticket.completion.borrow().clone();
            match completion {
                RepairCompletion::Pending => ticket.completion.changed().await.map_err(|_| {
                    SessionOpenError::internal(
                        &ticket.request.replay_context.local_session_id,
                        "Transcript repair ended without a completion result",
                    )
                })?,
                RepairCompletion::Finished(Ok(())) => return Ok(ticket.request),
                RepairCompletion::Finished(Err(error)) => return Err(error),
            }
        }
    }

    fn dispatch(self: &Arc<Self>, app: AppHandle) {
        loop {
            let job = {
                let mut state = self
                    .state
                    .lock()
                    .expect("transcript repair coordinator lock");
                if state.running >= self.max_concurrent_repairs {
                    return;
                }
                let Some(job) = state.pop_fair() else {
                    return;
                };
                state.running += 1;
                job
            };
            let coordinator = Arc::clone(self);
            let app_for_repair = app.clone();
            let app_for_next = app.clone();
            tauri::async_runtime::spawn(async move {
                let session_id = job.request.replay_context.local_session_id.clone();
                let result = run_repair_operation(
                    &session_id,
                    rebuild_canonical_transcript_ledger(app_for_repair, &job.request),
                    REPAIR_OPERATION_TIMEOUT,
                )
                .await;
                *job.completed_at
                    .lock()
                    .expect("transcript repair completion timestamp lock") = Some(Instant::now());
                job.completion
                    .send_replace(RepairCompletion::Finished(result));
                {
                    let mut state = coordinator
                        .state
                        .lock()
                        .expect("transcript repair coordinator lock");
                    state.active_sessions.remove(&session_id);
                    state.running = state.running.saturating_sub(1);
                }
                coordinator.dispatch(app_for_next);
            });
        }
    }
}

async fn run_repair_operation<F>(
    session_id: &str,
    operation: F,
    timeout: Duration,
) -> Result<(), SessionOpenError>
where
    F: Future<Output = Result<(), SessionOpenError>> + Send,
{
    match tokio::time::timeout(
        timeout,
        std::panic::AssertUnwindSafe(operation).catch_unwind(),
    )
    .await
    {
        Ok(Ok(result)) => result,
        Ok(Err(payload)) => {
            let message = panic_payload_message(payload.as_ref());
            tracing::error!(
                session_id = %session_id,
                panic = %message,
                "Transcript repair panicked; completing repair ticket with an error"
            );
            Err(SessionOpenError::internal(
                session_id,
                format!("Transcript repair panicked: {message}"),
            ))
        }
        Err(_) => {
            tracing::error!(
                session_id = %session_id,
                timeout_ms = timeout.as_millis(),
                "Transcript repair timed out; completing repair ticket with an error"
            );
            Err(SessionOpenError::provider_unavailable(
                session_id,
                format!(
                    "Transcript repair timed out after {} ms",
                    timeout.as_millis()
                ),
            ))
        }
    }
}

fn panic_payload_message(payload: &(dyn Any + Send)) -> String {
    payload
        .downcast_ref::<&str>()
        .map(|message| (*message).to_string())
        .or_else(|| payload.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "unknown panic payload".to_string())
}

const fn priority_rank(priority: TranscriptRepairPriority) -> u8 {
    match priority {
        TranscriptRepairPriority::Selected => 0,
        TranscriptRepairPriority::Visible => 1,
        TranscriptRepairPriority::Backfill => 2,
    }
}

async fn rebuild_canonical_transcript_ledger(
    app: AppHandle,
    request: &TranscriptRepairRequest,
) -> Result<(), SessionOpenError> {
    let session_id = &request.replay_context.local_session_id;
    let db = app.state::<DbConn>();
    let lifecycle = SessionGraphLifecycle::detached(
        crate::acp::lifecycle::DetachedReason::RestoredRequiresAttach,
    );
    let capabilities = SessionGraphCapabilities::empty();

    match load_provider_history_events(app.clone(), &request.replay_context).await {
        Ok(Some(events)) if !events.is_empty() => {
            let ctx = FoldContext::new(
                request.replay_context.local_session_id.clone(),
                request.replay_context.agent_id.clone(),
                request.replay_context.project_path.clone(),
            );
            let graph = fold_full(&events, &ctx);
            match rebuild_and_replace_current_transcript_row_ledger_from_session_graph(
                db.inner(),
                &request.replay_context,
                &lifecycle,
                &capabilities,
                &graph,
            )
            .await
            {
                Ok(Some(_)) => return Ok(()),
                Ok(None) => {}
                Err(error) => {
                    tracing::warn!(
                        session_id = %session_id,
                        error = %error,
                        "Fold-based transcript repair failed; falling back to provider snapshot"
                    );
                }
            }
        }
        Ok(_) => {}
        Err(error) => {
            tracing::warn!(
                session_id = %session_id,
                error = ?error,
                "Provider history events unavailable for fold repair; falling back to provider snapshot"
            );
        }
    }

    match load_provider_owned_session_snapshot(app.clone(), &request.replay_context).await {
        Ok(Some(snapshot)) => {
            let rebuilt = rebuild_and_replace_current_transcript_row_ledger_from_provider_snapshot(
                db.inner(),
                &request.replay_context,
                &lifecycle,
                &capabilities,
                &snapshot,
            )
            .await
            .map_err(|error| SessionOpenError::internal(session_id, error.to_string()))?;
            if rebuilt.is_some() {
                return Ok(());
            }
        }
        Ok(None) => {}
        Err(error) => return Err(session_open_error_from_provider_load(session_id, error)),
    }
    let rebuilt = rebuild_and_replace_current_transcript_row_ledger_from_journal(
        db.inner(),
        &request.replay_context,
        &lifecycle,
        &capabilities,
    )
    .await
    .map_err(|error| SessionOpenError::internal(session_id, error.to_string()))?;
    if rebuilt.is_some() {
        Ok(())
    } else {
        Err(SessionOpenError::provider_history_missing(
            session_id,
            "No provider history or canonical journal was available for transcript repair",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::{
        run_repair_operation, CoordinatorState, RepairCompletion, RepairJob,
        TranscriptRepairPriority, TranscriptRepairRequest,
    };
    use crate::acp::session_descriptor::{SessionDescriptorCompatibility, SessionReplayContext};
    use crate::acp::types::CanonicalAgentId;

    fn job(id: &str) -> RepairJob {
        let (completion, _) = tokio::sync::watch::channel(RepairCompletion::Pending);
        RepairJob {
            request: TranscriptRepairRequest {
                replay_context: SessionReplayContext {
                    local_session_id: id.to_string(),
                    history_session_id: id.to_string(),
                    agent_id: CanonicalAgentId::Codex,
                    parser_agent_type: crate::acp::parsers::AgentType::Codex,
                    project_path: "/repo".to_string(),
                    worktree_path: None,
                    effective_cwd: "/repo".to_string(),
                    source_path: None,
                    compatibility: SessionDescriptorCompatibility::Canonical,
                },
            },
            completion,
            completed_at: std::sync::Arc::new(std::sync::Mutex::new(None)),
        }
    }

    #[test]
    fn weighted_schedule_services_every_non_empty_priority_class() {
        let mut state = CoordinatorState::new();
        for ordinal in 0..4 {
            state
                .queue_mut(TranscriptRepairPriority::Selected)
                .push_back(job(&format!("selected-{ordinal}")));
        }
        for ordinal in 0..2 {
            state
                .queue_mut(TranscriptRepairPriority::Visible)
                .push_back(job(&format!("visible-{ordinal}")));
        }
        state
            .queue_mut(TranscriptRepairPriority::Backfill)
            .push_back(job("backfill-0"));

        let mut scheduled = Vec::new();
        while let Some(next) = state.pop_fair() {
            scheduled.push(next.request.replay_context.local_session_id);
        }

        assert_eq!(
            scheduled,
            vec![
                "selected-0",
                "selected-1",
                "selected-2",
                "selected-3",
                "visible-0",
                "visible-1",
                "backfill-0",
            ]
        );
    }

    #[test]
    fn continuously_busy_selected_queue_does_not_starve_lower_priorities() {
        let mut state = CoordinatorState::new();
        state
            .queue_mut(TranscriptRepairPriority::Visible)
            .push_back(job("visible"));
        state
            .queue_mut(TranscriptRepairPriority::Backfill)
            .push_back(job("backfill"));
        for ordinal in 0..20 {
            state
                .queue_mut(TranscriptRepairPriority::Selected)
                .push_back(job(&format!("selected-{ordinal}")));
        }

        let first_seven = (0..7)
            .filter_map(|_| state.pop_fair())
            .map(|next| next.request.replay_context.local_session_id)
            .collect::<Vec<_>>();

        assert!(first_seven.iter().any(|id| id == "visible"));
        assert!(first_seven.iter().any(|id| id == "backfill"));
    }

    #[test]
    fn selected_request_promotes_a_queued_backfill_repair() {
        let mut state = CoordinatorState::new();
        state
            .queue_mut(TranscriptRepairPriority::Backfill)
            .push_back(job("promoted"));
        state
            .queue_mut(TranscriptRepairPriority::Selected)
            .push_back(job("already-selected"));

        state.promote_queued("promoted", TranscriptRepairPriority::Selected);

        let scheduled = (0..2)
            .filter_map(|_| state.pop_fair())
            .map(|next| next.request.replay_context.local_session_id)
            .collect::<Vec<_>>();
        assert_eq!(scheduled, vec!["already-selected", "promoted"]);
        assert!(state.backfill.is_empty());
    }

    #[tokio::test]
    async fn repair_worker_panic_becomes_a_completed_error() {
        let result = run_repair_operation(
            "panic-session",
            async {
                panic!("provider history panic");
                #[allow(unreachable_code)]
                Ok(())
            },
            std::time::Duration::from_secs(1),
        )
        .await;

        let error = result.expect_err("repair panic must resolve the repair ticket");
        assert!(matches!(
            error.reason,
            crate::acp::session_open_snapshot::SessionOpenErrorReason::Internal
        ));
        assert!(error.message.contains("provider history panic"));
    }

    #[tokio::test]
    async fn repair_worker_timeout_becomes_a_completed_error() {
        let result = tokio::time::timeout(
            std::time::Duration::from_millis(100),
            run_repair_operation(
                "timeout-session",
                std::future::pending::<
                    Result<(), crate::acp::session_open_snapshot::SessionOpenError>,
                >(),
                std::time::Duration::from_millis(10),
            ),
        )
        .await
        .expect("repair timeout must resolve before the test deadline");

        let error = result.expect_err("repair timeout must resolve the repair ticket");
        assert!(matches!(
            error.reason,
            crate::acp::session_open_snapshot::SessionOpenErrorReason::ProviderUnavailable
        ));
        assert!(error.message.contains("timed out"));
    }
}
