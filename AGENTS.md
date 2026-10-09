# Phoenix Vanz Frontend Instructions

## Repository

This is the Nuxt frontend for phoenixvanz.com.

The Django backend is a separate repository. Do not assume backend files are
available in this workspace.

## Safe workflow

- Inspect the current implementation before editing.
- Work only on the current feature branch.
- Make the smallest reviewable patch.
- Do not replace complete files when a targeted edit is sufficient.
- Do not modify or replace existing GitHub workflows unless explicitly asked.
- Do not commit, push, merge or deploy without explicit approval.
- Always show the final changed-file list and git diff summary.
- Preserve working functionality outside the requested scope.

## Validation

Before declaring work complete:

1. Run `npm run` to discover available scripts.
2. Run `npm run build`.
3. Run other checks only when their scripts exist.
4. Run `git diff --check`.
5. Report any manual browser checks still required.

Never claim `npm run test`, `lint` or `typecheck` passed unless the script
exists and was actually run.

## Architecture

- Nuxt server routes proxy requests to Django.
- Do not expose backend credentials to browser code.
- Keep API base URLs in runtime configuration.
- Handle upstream Django failures without crashing page rendering.
- Preserve SSR safety: API data can temporarily be null, undefined or empty.
- Use optional chaining or explicit guards where SSR can encounter empty data.

## Current project decisions

- The Google Reviews Django replacement is deferred. Do not begin it unless
  explicitly requested.
- Elfsight remains temporarily while the replacement is deferred.
- The contact enquiry delivery feature is a current priority.
- Checkout will use a one-third deposit with the balance due on completion.
- Homepage remote slides and fallback loading are already implemented.
- Do not regress the homepage image-loading optimisation.

Before reporting a feature checkpoint complete, update todos.txt with the
implementation status, actual verification, branch/code reference and remaining
release work. Committed does not mean merged or deployed. Deployment status
changes only with recorded deployment evidence.

## Git safety

- Never work directly on `master` for a feature.
- Never use force push.
- Never replace workflow files.
- Prefer one feature or fix per branch.