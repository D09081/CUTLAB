# CUTLAB

Mobile-first web video clipping studio. Includes upload, manually selected clip ranges, FFmpeg MP4 export and aspect-ratio conversion.

## Run locally
Requires Node.js 20+.
```bash
npm install
npm start
```
Open http://localhost:3000

## Deploy to Render
1. Push this folder to a GitHub repository.
2. In Render create a Web Service from that repository.
3. Render reads `render.yaml`; set `healthCheckPath: /health`.
4. Persistent disk is configured for uploaded media and exports.

## Current MVP limits
- Clip boundaries are selected manually; automatic semantic highlight detection and transcription are not implemented yet.
- Files are held on the server disk; use a persistent disk for deployed projects.
- The initial upload is kept in memory metadata, so a server restart requires re-uploading the source.
- The SHA-256 is for recognizing identical source files in this app, not for bypassing copyright or platform moderation.
- Large videos require sufficient server RAM, disk and processing time.

## История
История загрузок и экспортов хранится в `data/history.json`. Для сохранения истории и файлов между перезапусками подключите постоянный диск и задайте `DATA_DIR` на путь его монтирования. Без постоянного диска данные могут исчезнуть при пересоздании контейнера.
