use super::*;

const TELEMETRY_INTERVAL: Duration = Duration::from_secs(5);

#[derive(Debug, Clone)]
pub struct DispatchPolicy {
    pub max_global_backlog: usize,
    pub max_session_backlog: usize,
}

impl Default for DispatchPolicy {
    fn default() -> Self {
        Self {
            max_global_backlog: 5000,
            max_session_backlog: 500,
        }
    }
}

pub(super) struct DispatcherTelemetry {
    pub(super) enqueued: u64,
    pub(super) emitted: u64,
    pub(super) dropped: u64,
    pub(super) max_backlog: usize,
    pub(super) max_wait_ms: u128,
    pub(super) last_report: Instant,
}

impl DispatcherTelemetry {
    pub(super) fn new() -> Self {
        Self {
            enqueued: 0,
            emitted: 0,
            dropped: 0,
            max_backlog: 0,
            max_wait_ms: 0,
            last_report: Instant::now(),
        }
    }

    pub(super) fn maybe_report(&mut self, backlog: usize) {
        self.max_backlog = self.max_backlog.max(backlog);

        if self.last_report.elapsed() < TELEMETRY_INTERVAL {
            return;
        }

        tracing::debug!(
            enqueued = self.enqueued,
            emitted = self.emitted,
            dropped = self.dropped,
            max_backlog = self.max_backlog,
            max_wait_ms = self.max_wait_ms,
            "ACP UI dispatcher telemetry"
        );

        if self.dropped > 0 {
            tracing::warn!(
                dropped = self.dropped,
                max_backlog = self.max_backlog,
                "ACP UI dispatcher dropped events"
            );
        }

        self.enqueued = 0;
        self.emitted = 0;
        self.dropped = 0;
        self.max_backlog = 0;
        self.max_wait_ms = 0;
        self.last_report = Instant::now();
    }
}
