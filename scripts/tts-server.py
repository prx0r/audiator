#!/usr/bin/env python3
"""Simple TTS server compatible with Kokoro-FastAPI /v1/audio/speech endpoint.
Uses edge-tts (Microsoft Edge free TTS) under the hood.
"""

import asyncio
import json
import io
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler

import edge_tts

VOICE_MAP = {
    "af_heart": "en-US-AriaNeural",
    "af_bella": "en-US-JennyNeural",
    "am_mich": "en-US-GuyNeural",
    "am_adam": "en-US-ChristopherNeural",
    "default": "en-US-AriaNeural",
}

async def generate_speech(text: str, voice: str = "af_heart", format: str = "mp3") -> bytes:
    edge_voice = VOICE_MAP.get(voice, VOICE_MAP["default"])
    communicate = edge_tts.Communicate(text, edge_voice)
    audio_data = io.BytesIO()
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            audio_data.write(chunk["data"])
    return audio_data.getvalue()


class TTSHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/v1/audio/speech":
            self.send_response(404)
            self.end_headers()
            return

        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length)
        try:
            params = json.loads(body)
        except json.JSONDecodeError:
            self.send_error(400, "Invalid JSON")
            return

        text = params.get("input", "")
        voice = params.get("voice", "af_heart")
        fmt = params.get("response_format", "mp3")

        if not text:
            self.send_error(400, "Missing input text")
            return

        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            audio_bytes = loop.run_until_complete(generate_speech(text, voice, fmt))
        except Exception as e:
            self.send_error(500, str(e))
            return
        finally:
            loop.close()

        self.send_response(200)
        content_type = "audio/mpeg" if fmt == "mp3" else "audio/wav"
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(audio_bytes)))
        self.end_headers()
        self.wfile.write(audio_bytes)

    def log_message(self, format, *args):
        sys.stderr.write("[TTS] %s\n" % (format % args))


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8880
    server = HTTPServer(("127.0.0.1", port), TTSHandler)
    print(f"[TTS] edge-tts server running on http://127.0.0.1:{port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
