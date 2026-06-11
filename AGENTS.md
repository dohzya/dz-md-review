# AGENTS.md

## Code

- Write extension code in English.
- Use TDD for behavior changes: add or update a failing unit test first, then
  implement the smallest change that makes it pass.
- Keep `src/extension.ts` as the source of truth. Generate `out/extension.js`
  with `npm run compile`; do not edit generated files by hand.

## Validation

- Before declaring work done, run:
  - `npm test`
  - `npm run check`
