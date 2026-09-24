-- 0022_quarantine_language.sql — a rejected Korean version can be quarantined (ADR-0064).
--
-- WHY. quarantine_versions was created in 0001 as `LIKE manuscript_versions INCLUDING CONSTRAINTS`, so it
-- copied the ADR-0026 check `language = 'en'`. Migration 0020 widened manuscript_versions to ('en', 'ko') but
-- not the copy, so canon.quarantine_version failed for every Korean version and a rejected Korean draft
-- could not leave manuscript_versions — the "rejected drafts quarantined" invariant did not hold for Korean
-- projects. Found by the first Korean run that discards a regressed patch.
--
-- SCOPE. Only the copied language check; the quarantine table keeps every other constraint and grant.

ALTER TABLE quarantine_versions
  DROP CONSTRAINT manuscript_versions_language_check,
  ADD CONSTRAINT quarantine_versions_language_check CHECK (language IN ('en', 'ko'));
