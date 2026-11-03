E-Reader Pro V24 - International news RSS reader.

Update repository ereader with files in this ZIP. Preserve existing drive-config.js, which stores Google OAuth Web Client ID; this update excludes it.

New: news.js, news.css, api/news.js, HUONG_DAN_V24_BAO_QUOC_TE.txt.
Updated: index.html (includes the compact V23 note-editor UI), sw.js (PWA cache v24).
Other included files come from V22 and are retained unchanged, including Google Drive synchronization, EPUB/Word, translation, dictionary and voice endpoints.

News functionality is a separate reader panel. Publisher RSS summaries and headlines only; link to original article for full reading. User-selected words/news are not uploaded to Google Drive in this version. News TTS uses device speech synthesis.

Deployment requires Vercel serverless Functions (api/news.js). Bare HTML opened from file:// cannot retrieve live RSS directly.
