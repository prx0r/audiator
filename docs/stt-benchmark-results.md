# STT Benchmark Results

Initial status: benchmark harness is scaffolded, but no Vosk/sherpa/whisper.cpp service has been run yet.

Current local verification on the deterministic text runtime:

- `npm test`: pass
- `npm run simulate:call`: pass after fixture simulation is available
- `node scripts/benchmark-stt.mjs`: skips until STT audio fixtures and provider service are available

Before selecting a production STT provider, run the benchmark with recorded WAV fixtures and record intent accuracy, p95 STT latency, RSS, and crash behavior here.
