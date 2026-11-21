## Standards

Reviewed `git diff caf4f68...189a11f` and its commits against `.editorconfig`,
`GLOSSARY.md`, `DESIGN.md`, `COPY.md`, plus the supplied smell baseline.

1. **Documented rule, P1 — photo retry is offered but fails against the real API.**
   `web/app.js:836` sends `request(.../retry, { method: "POST" })` without JSON.
   `server.py:200` calls `self.body()`, which requires a nonempty JSON body.
   A signed request matching the browser returned HTTP 400,
   `Требуется JSON запроса.` This violates `COPY.md:71`: show
   «Повторить» only «если повтор действительно реализован».
   Send `{}` as JSON or consistently support an empty retry request; cover the
   actual browser-to-server path rather than permissive mocked HTTP only.

2. **Judgement call — Duplicated Code / Repeated Switches.**
   `web/app.js:91` and `:325` independently declare the same eight-entry media
   label map (`photo: "Фото", video: "Видео", ...`). Photo-status labels are
   also repeated at `:112` and `:804`. A wording/type change must update parallel
   paths or the list preview and opened entry diverge. Share the two maps inside
   this module; no cross-language abstraction or module rewrite is needed.

No other actionable documented-standard violations found. Formatting-only matters
handled by editor tooling were excluded. Data-retention correctness belongs to
the independent Spec axis.

Summary: 1 documented-rule violation and 1 heuristic finding; worst Standards
issue is the nonfunctional photo retry action.
