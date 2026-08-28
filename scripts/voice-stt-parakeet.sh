#!/usr/bin/env bash
# Speech to text for Acepe, through NVIDIA Parakeet TDT 0.6B v3 on MLX.
#
# Acepe runs this with no arguments and reads what it prints:
#   ACEPE_VOICE_AUDIO_PATH   the recording, 16-bit mono wav (always set)
#   ACEPE_VOICE_STT_MODEL_PATH   a HuggingFace repo id, optional
#   ACEPE_VOICE_LANGUAGE     a language hint, optional and unused here:
#                            parakeet v3 detects the language itself
# stdout is the transcript. Anything else belongs on stderr.
#
# The model is ~600M parameters and downloads to ~/.cache/huggingface on the
# first run, about 2.5GB. Every run after that is local and takes well under a
# second for a normal dictation.
set -euo pipefail

# A GUI app started by launchd has nowhere to print, so a run that fails leaves
# no trace at all. ACEPE_VOICE_STT_DEBUG=1 writes one line per invocation, plus
# the model output, where a QA run can read it.
DEBUG_LOG="${TMPDIR:-/tmp}/acepe-voice-stt.log"
debug() {
  if [ "${ACEPE_VOICE_STT_DEBUG:-}" = "1" ]; then
    echo "$(date -u +%H:%M:%S) $*" >>"$DEBUG_LOG"
  fi
}

MODEL="${ACEPE_VOICE_STT_MODEL_PATH:-mlx-community/parakeet-tdt-0.6b-v3}"
PARAKEET="${ACEPE_VOICE_PARAKEET_BIN:-$HOME/.local/bin/parakeet-mlx}"

debug "invoked audio=${ACEPE_VOICE_AUDIO_PATH:-unset} model=$MODEL"
if [ "${ACEPE_VOICE_STT_DEBUG:-}" = "1" ] && [ -f "${ACEPE_VOICE_AUDIO_PATH:-}" ]; then
  cp "$ACEPE_VOICE_AUDIO_PATH" "$DEBUG_LOG.wav"
fi

if [ -z "${ACEPE_VOICE_AUDIO_PATH:-}" ]; then
  echo "ACEPE_VOICE_AUDIO_PATH is not set" >&2
  exit 2
fi

if [ ! -x "$PARAKEET" ]; then
  echo "parakeet-mlx not found at $PARAKEET. Install it with: uv tool install parakeet-mlx -U" >&2
  exit 3
fi

# parakeet-mlx writes a file named after the input and has no stdout mode, so
# it gets a scratch directory of its own and the transcript is read back out.
OUT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/acepe-parakeet.XXXXXX")"
trap 'rm -rf "$OUT_DIR"' EXIT

"$PARAKEET" "$ACEPE_VOICE_AUDIO_PATH" \
  --model "$MODEL" \
  --output-format txt \
  --output-dir "$OUT_DIR" >&2

BASE="$(basename "$ACEPE_VOICE_AUDIO_PATH")"
TRANSCRIPT="$OUT_DIR/${BASE%.*}.txt"

if [ ! -f "$TRANSCRIPT" ]; then
  echo "parakeet-mlx wrote no transcript for $ACEPE_VOICE_AUDIO_PATH" >&2
  exit 4
fi

debug "transcript $(wc -c <"$TRANSCRIPT" | tr -d ' ') bytes"
cat "$TRANSCRIPT"
