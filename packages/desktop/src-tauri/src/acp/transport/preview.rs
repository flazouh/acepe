use async_trait::async_trait;

use crate::acp::error::AcpResult;
use crate::acp::transport::events::TransportCapabilitySnapshot;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreviewRequest {
    pub cwd: String,
}

#[async_trait]
pub trait PreviewAdapter: Send + Sync {
    async fn preview_capabilities(
        &self,
        request: PreviewRequest,
    ) -> AcpResult<TransportCapabilitySnapshot>;
}
