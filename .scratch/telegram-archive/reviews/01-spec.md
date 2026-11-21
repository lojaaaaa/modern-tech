## Spec

Reviewed `git diff caf4f68...189a11f` against `tools/telegram-media-probe/SPEC.md` and its linked DESIGN/COPY. Three reproducible findings:

1. **P1 — Manual deletion leaves correspondence in the active WAL.** `archive.py:512–534` commits `delete_entry`/clear operations without the checkpoint used by `expire()`. SPEC: «Очистка удаляет соответствующие события, фото и фоновые копии» (166); «нельзя очистить только видимую запись» (174). Running `/tmp/modern-tech-telegram-notes/check-manual-scrub.py` yields zero API entries while the deleted marker remains in `archive.sqlite3-wal`. Scrub all manual deletion paths after commit, with regression coverage.

2. **P2 — Photo retry cannot succeed from the Mini App.** `web/app.js:836–838` sends POST `/api/entries/{id}/retry` without a body; `server.py:200` calls `body()`, which rejects an absent/nonempty JSON body at 106–115. SPEC requires photo errors «с понятным следующим действием» (136–138); COPY supplies «Повторить» when implemented. `/tmp/modern-tech-telegram-notes/review-spec-repro.py` confirms frontend-style POST → 400 «Требуется JSON запроса.», whereas `{}` → 200. Align client and server and verify through the real browser/API boundary.

3. **P2 — Expiration loses the known own-message side.** `archive.py:105–107` erases the only author metadata for an ordinary own message; `244–267` subsequently infers `own=False` when deletion has no retained content. SPEC: «О собственных изменениях и удалениях уведомлений нет» (143), «Собственные действия не увеличивают счётчик» (122). Reproduced via public Archive: ingest an owner-authored ordinary message, advance the clock 31 days, ingest deletion. Result: `own=False`, `read=False`, one notice. Preserve minimal message-side metadata independently of expired content, without retaining the text beyond 30 days.

No additional scope-creep finding. Automatic temporary-photo retrieval is explicitly a separate research branch, so missing live evidence is not treated as an implementation defect here.

Spec: **3 findings**; worst within this axis: retained deleted correspondence in active WAL (P1).
