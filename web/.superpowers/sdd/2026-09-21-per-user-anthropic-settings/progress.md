# SDD ledger — plan: docs/superpowers/plans/2026-09-21-per-user-anthropic-settings.md

Setup: Ruling: Git worktree and commits are unavailable because `.git` is not valid — execute in `/home/ajmal/Downloads/cadence/web` and preserve task evidence here — cost if wrong: no automatic Git rollback or task commit history.
Pre-flight: Task 1 schema/types → Tasks 4/5/6 settings and run consumers: names and nullable legacy snapshots match.
Pre-flight: Task 2 encryption/config → Tasks 4/6 credential consumers: owner-bound context and shared environment key match.
Pre-flight: Task 3 catalog/errors/factory → Tasks 4/6/7 API, worker, and UI consumers: model IDs and stable error codes match.
Pre-flight: Task 4 settings service/API → Tasks 5/6/7/8 consumers: safe snapshot is separate from decrypted runtime settings.
Pre-flight: Task 5 run snapshots → Task 6 worker: worker uses snapshot models and current valid key revision.
Pre-flight: Task 6 safe failures → Tasks 7/8 user messages and verification: stable codes match.
Task 1: Completed: private tables, nullable legacy run snapshots, browser grants revoked; local pgTAP 9/9 passed. Ruling: moved standalone plain-PostgreSQL scripts outside `supabase/tests` because they are setup scripts rather than pgTAP files.
Task 2: Completed: owner-bound AES-256-GCM and shared web/worker credential configuration; crypto and config tests passed.
Task 3: Completed: curated Sonnet/Opus catalog, Models API validation, coded sanitized provider errors, explicit Claude factory; focused tests passed.
Task 4: Completed: authenticated safe settings API, atomic validated replacement, five-per-minute limiter, deletion guard, owner isolation; database integrations passed.
Task 5: Completed: creation and revision gates plus enqueue-time model/revision snapshots; focused and worker integration tests passed.
Task 6: Completed: per-claimed-owner credential loading, snapshot-model client construction, revision-guarded invalidation, sanitized persisted failures; worker tests passed.
Task 7: Completed: `/settings` UI, central LinkedIn panel, compatibility redirect, navigation, and Create gate; five UI tests passed.
Task 8: Completed except live two-user external-credential check: exports omit secrets, docs/env updated, legacy global runtime inputs removed, all 74 tests plus lint/build passed. Remote migration `202609210005_user_ai_settings.sql` applied; follow-up dry run reports up to date.
Release: Pending external check: two dedicated Anthropic keys, two signed-in users, harmless generations, replacement/removal behavior, and LinkedIn reconnect require live credentials and interactive accounts.
Review: Independent code review found and implementation fixed stale-key CAS, enqueue/delete serialization, worker failure-write resilience, invalid-status HTTP semantics, request-ID correlation, safe catalog failures, and separate Settings actions with validation time.
