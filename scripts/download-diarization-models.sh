#!/bin/bash
# Download sherpa-onnx speaker diarization models for audiator
# Usage: bash scripts/download-diarization-models.sh

set -e

MODELS_DIR="data/models"
mkdir -p "$MODELS_DIR"

echo "Downloading pyannote segmentation model (6.8MB)..."
SEG_DIR="$MODELS_DIR/sherpa-onnx-pyannote-segmentation-3-0"
if [ ! -f "$SEG_DIR/model.onnx" ]; then
  mkdir -p "$SEG_DIR"
  curl -L -o "$SEG_DIR/model.onnx" \
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0/model.onnx"
  echo "  Done."
else
  echo "  Already exists, skipping."
fi

echo "Downloading 3D-Speaker embedding model (37.7MB)..."
EMB_MODEL="$MODELS_DIR/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx"
if [ ! -f "$EMB_MODEL" ]; then
  curl -L -o "$EMB_MODEL" \
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx"
  echo "  Done."
else
  echo "  Already exists, skipping."
fi

echo ""
echo "Models downloaded to $MODELS_DIR"
echo "Total: ~45MB"
ls -lh "$SEG_DIR/model.onnx" "$EMB_MODEL"
