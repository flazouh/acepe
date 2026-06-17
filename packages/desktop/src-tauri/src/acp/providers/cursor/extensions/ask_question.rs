use crate::acp::provider_extensions::{
    InboundResponseAdapter, ProviderExtensionEvent, QuestionOptionResponseAdapter,
    QuestionResponseAdapter,
};
use crate::acp::session_update::{
    QuestionData, QuestionItem, QuestionOption, SessionUpdate, ToolReference,
};
use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AskQuestionParams {
    tool_call_id: Option<String>,
    title: Option<String>,
    #[serde(default)]
    questions: Vec<AskQuestionItem>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AskQuestionItem {
    id: Option<String>,
    prompt: Option<String>,
    #[serde(default)]
    options: Vec<AskQuestionOption>,
    #[serde(default)]
    allow_multiple: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AskQuestionOption {
    id: Option<String>,
    label: Option<String>,
}

pub(crate) fn normalize(
    params: &Value,
    request_id: Option<u64>,
    session_id: String,
) -> Result<ProviderExtensionEvent, String> {
    let parsed: AskQuestionParams =
        serde_json::from_value(params.clone()).map_err(|error| error.to_string())?;

    let header = parsed.title.unwrap_or_else(|| "Question".to_string());
    let mut adapter_questions = Vec::new();
    let mut canonical_questions = Vec::new();

    for (index, question) in parsed.questions.into_iter().enumerate() {
        let question_text = question.prompt.unwrap_or_else(|| header.clone());
        let question_id = question
            .id
            .unwrap_or_else(|| format!("cursor-question-{index}"));

        let mut adapter_options = Vec::new();
        let mut canonical_options = Vec::new();

        for (option_index, option) in question.options.into_iter().enumerate() {
            let label = option.label.unwrap_or_else(|| {
                option
                    .id
                    .clone()
                    .unwrap_or_else(|| format!("Option {}", option_index + 1))
            });
            let option_id = option.id.unwrap_or_else(|| label.clone());
            adapter_options.push(QuestionOptionResponseAdapter {
                label: label.clone(),
                option_id,
            });
            canonical_options.push(QuestionOption {
                label,
                description: String::new(),
            });
        }

        adapter_questions.push(QuestionResponseAdapter {
            question: question_text.clone(),
            question_id,
            options: adapter_options,
        });
        canonical_questions.push(QuestionItem {
            question: question_text,
            header: header.clone(),
            options: canonical_options,
            multi_select: question.allow_multiple,
        });
    }

    Ok(ProviderExtensionEvent {
        updates: vec![SessionUpdate::QuestionRequest {
            question: QuestionData {
                id: parsed
                    .tool_call_id
                    .clone()
                    .unwrap_or_else(|| format!("cursor-question-{request_id:?}")),
                session_id: session_id.clone(),
                json_rpc_request_id: request_id,
                reply_handler: request_id
                    .map(crate::acp::session_update::InteractionReplyHandler::json_rpc)
                    .or_else(|| {
                        Some(crate::acp::session_update::InteractionReplyHandler::http(
                            parsed
                                .tool_call_id
                                .clone()
                                .unwrap_or_else(|| format!("cursor-question-{request_id:?}")),
                        ))
                    }),
                questions: canonical_questions,
                tool: parsed.tool_call_id.as_ref().map(|id| ToolReference {
                    message_id: None,
                    call_id: id.clone(),
                }),
            },
            session_id: Some(session_id),
        }],
        response_adapter: Some(InboundResponseAdapter::AskQuestion {
            questions: adapter_questions,
        }),
    })
}
