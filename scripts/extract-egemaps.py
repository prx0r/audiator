#!/usr/bin/env python3
"""Extract openSMILE eGeMAPS features from a WAV file and output JSON."""
import json
import sys
import warnings

warnings.filterwarnings("ignore")

try:
    import opensmile
    import soundfile as sf
    import numpy as np
except ImportError as e:
    print(json.dumps({"error": f"Missing dependency: {e}"}), flush=True)
    sys.exit(1)


def extract(wav_path: str) -> dict:
    audio, sr = sf.read(wav_path)

    if len(audio.shape) > 1:
        audio = audio.mean(axis=1)

    if sr != 16000:
        print(
            json.dumps({"error": f"Sample rate {sr} != 16000, resample first"}),
            flush=True,
        )
        sys.exit(1)

    smile = opensmile.Smile(
        feature_set=opensmile.FeatureSet.eGeMAPSv02,
        feature_level=opensmile.FeatureLevel.Functionals,
    )

    result = smile.process_signal(audio, sr)

    if result.empty:
        return {"error": "no_features"}

    row = result.iloc[0].to_dict()

    features = {}
    for key, val in row.items():
        clean_key = key.replace("[", "_").replace("]", "").rstrip("_")
        try:
            features[clean_key] = float(val) if not np.isnan(float(val)) else None
        except (ValueError, TypeError):
            features[clean_key] = None

    return {
        "numFeatures": len(features),
        "features": features,
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: extract-egemaps.py <wav_path>"}), flush=True)
        sys.exit(1)

    result = extract(sys.argv[1])
    print(json.dumps(result), flush=True)
