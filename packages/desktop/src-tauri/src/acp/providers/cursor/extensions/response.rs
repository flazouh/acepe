use crate::acp::provider_extensions::{
    InboundResponseAdapter, QuestionOptionResponseAdapter, QuestionResponseAdapter,
};
use serde_json::{json, Map, Value};

pub fn adapt_cursor_response(adapter: &InboundResponseAdapter, result: &Value) -> Value {
    let outcome = result
        .pointer("/outcome/outcome")
        .and_then(|value| value.as_str())
        .unwrap_or("selected");

    match adapter {
        InboundResponseAdapter::AskQuestion { questions } => {
            if outcome == "cancelled" {
                return json!({
                    "outcome": {
                        "outcome": "skipped",
                        "reason": "User cancelled questions",
                    }
                });
            }

            let answers = extract_answer_map(result);
            let mapped_answers = questions
                .iter()
                .filter_map(|question| {
                    let selected_labels = answers.get(&question.question)?;
                    let selected_option_ids = selected_values(selected_labels)
                        .iter()
                        .filter_map(|label| {
                            question
                                .options
                                .iter()
                                .find(|option| option.label == *label)
                                .map(|option| option.option_id.clone())
                        })
                        .collect::<Vec<_>>();

                    Some(json!({
                        "questionId": question.question_id,
                        "selectedOptionIds": selected_option_ids,
                    }))
                })
                .collect::<Vec<_>>();

            json!({
                "outcome": {
                    "outcome": "answered",
                    "answers": mapped_answers,
                }
            })
        }
        InboundResponseAdapter::CreatePlan { plan_uri } => {
            if outcome == "cancelled" {
                return json!({
                    "outcome": {
                        "outcome": "cancelled",
                        "reason": "User cancelled plan approval",
                    }
                });
            }

            let approved = result
                .get("approved")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

            if approved {
                json!({
                    "outcome": {
                        "outcome": "accepted",
                        "planUri": plan_uri,
                    }
                })
            } else {
                json!({
                    "outcome": {
                        "outcome": "rejected",
                        "reason": "User rejected plan",
                    }
                })
            }
        }
    }
}

fn extract_answer_map(result: &Value) -> Map<String, Value> {
    result
        .pointer("/_meta/answers")
        .and_then(|value| value.as_object())
        .cloned()
        .unwrap_or_default()
}

fn selected_values(value: &Value) -> Vec<String> {
    match value {
        Value::String(single) => vec![single.clone()],
        Value::Array(values) => values
            .iter()
            .filter_map(|entry| entry.as_str().map(ToString::to_string))
            .collect(),
        _ => Vec::new(),
    }
}
