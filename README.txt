E-Reader Pro V24.2 | VOA Learning English + Google Drive

Deploy to Vercel via GitHub. Preserve your existing drive-config.js (OAuth Client ID): excluded intentionally from this ZIP.
Includes verified official VOA Learning English RSS endpoints; VOA text-only article extractor with title/preview fallback and third-party-content exclusion; per-sentence translations; tap-word / phrase dictionary; TTS through existing E-Reader settings and cache; article translation manifest sync through Google Drive.

API health: /api/news?health=1 => {ok:true,version:'24.2'}.
Article API: /api/article?url=<encoded VOA article URL> (fixed VOA domain allowlist only).
Google/Gemini audio is saved via the existing E-Reader Pro/Audio Cache Drive folder if signed in and enabled.
No Google OAuth client secret, API Key or credentials are shipped in ZIP.
See HUONG_DAN_V24_2_VOA.txt for installation and caveats.
