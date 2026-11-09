# Margin Reader — English reading & audiobook alignment

Web app (no local server or shell script): https://hyskim74.github.io/SAIL/

## Automatic sync (no manual audio-time input)

1. Import the English book PDF / EPUB / TXT.
2. Import the matching MP3 / M4A / WAV / MP4 audiobook in the Audiobook tab.
3. Select the **first sentence of the actual story** (not the preface, prologue, or introduction). Press **① 본문 시작 표시**.
4. Press **② 본문 시작 자동 검색 + 전체 단어 싱크**.
5. The browser scans the audiobook itself using Whisper transcription. Once the story's start is found, it progressively associates spoken words and timestamps with the book. You can stop/resume the operation; no audio start/end times are requested.
6. Select a **mapped** text passage and press **Play selection**. Unmapped passages cannot be played precisely until automatic processing reaches them.

**Limits:** This is browser-only ASR + text matching, not a guaranteed word-perfect forced alignment. Some words may have missing/inaccurate timestamps. First use downloads an ASR model; older/low-memory browsers may fail. Large media are decoded in bounded clips using native media playback, so scanning can take real time and a long book can take hours. Keep the browser tab open; browsers may restrict autoplay/media capture. MP4 codec compatibility varies.

## Storage

- This Public repository contains only web app code.
- Personal notes, reading progress, and alignment metadata are saved locally, and can synchronize to the **Private** repository `hyskim74/Data` after connecting a fine-grained GitHub token (Contents: read/write on Data only).
- Audiobooks can be saved/restored from `Data/audiobooks/` in chunks; the per-file app cap is 1 GiB.
- Original PDF/EPUB source files are not automatically uploaded to GitHub.
- Never commit GitHub tokens, copyrighted source books, or personal notes to this Public repository.

This app requires only opening the GitHub Pages URL. No `run.sh`, local Python, or separate server is required.
