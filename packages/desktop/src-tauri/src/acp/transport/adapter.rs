use async_trait::async_trait;

use crate::acp::error::AcpResult;
use crate::acp::transport::connection::TransportConnection;
use crate::acp::transport::events::TransportCapabilitySnapshot;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RetryBackoffHint {
    pub disposition: RetryDisposition,
    pub next_backoff_ms: Option<u64>,
    pub max_backoff_ms: Option<u64>,
}

impl RetryBackoffHint {
    #[must_use]
    pub fn retryable(next_backoff_ms: Option<u64>, max_backoff_ms: Option<u64>) -> Self {
        Self {
            disposition: RetryDisposition::Retryable,
            next_backoff_ms,
            max_backoff_ms,
        }
    }

    #[must_use]
    pub fn terminal() -> Self {
        Self {
            disposition: RetryDisposition::Terminal,
            next_backoff_ms: None,
            max_backoff_ms: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RetryDisposition {
    Retryable,
    Terminal,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResumePolicy {
    pub use_load_semantics: bool,
    pub retry: RetryBackoffHint,
}

impl Default for ResumePolicy {
    fn default() -> Self {
        Self {
            use_load_semantics: false,
            retry: RetryBackoffHint::retryable(None, None),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConnectRequest {
    pub session_id: String,
    pub cwd: String,
    pub initial_prompt: Option<String>,
    pub launch_mode_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResumeRequest {
    pub session_id: String,
    pub cwd: String,
    pub launch_mode_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ForkRequest {
    pub session_id: String,
    pub cwd: String,
}

#[async_trait]
pub trait TransportAdapter: Send + Sync {
    async fn connect(&self, request: ConnectRequest) -> AcpResult<TransportConnection>;

    async fn resume(&self, request: ResumeRequest) -> AcpResult<TransportConnection>;

    fn resume_policy(&self) -> ResumePolicy;

    async fn fork(&self, request: ForkRequest) -> AcpResult<TransportCapabilitySnapshot>;
}
