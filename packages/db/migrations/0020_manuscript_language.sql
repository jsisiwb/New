-- 0020_manuscript_language.sql — allow Korean manuscripts (ADR-0054).
--
-- WHY. The manuscript language is now per-project data chosen by the intake (en or ko). The CHECK
-- constraints that pinned every language-bearing column to 'en' were written under ADR-0026 and would
-- reject a single Korean paragraph. This migration enlarges the closed sets without touching defaults:
-- existing rows and the English fixture lineage keep 'en' (defaults stay 'en'), and a project that
-- declares ko receives and stores Korean manuscript text.
--
-- SCOPE. Only the four constraints that gate manuscript-shaped text: projects.output_language,
-- manuscript_versions.language, summaries.language and search_documents.language. Terminology, naming
-- and register data were already language-neutral. The application intent is also recorded per row via
-- the `language` column itself, never assumed from a check.
--
-- ROLLBACK. Forward-only (data architecture §15): this migration only relaxes constraints; nothing is
-- dropped or rewritten.

ALTER TABLE projects
  DROP CONSTRAINT projects_output_language_check,
  ADD CONSTRAINT projects_output_language_check CHECK (output_language IN ('en', 'ko'));

ALTER TABLE manuscript_versions
  DROP CONSTRAINT manuscript_versions_language_check,
  ADD CONSTRAINT manuscript_versions_language_check CHECK (language IN ('en', 'ko'));

ALTER TABLE summaries
  DROP CONSTRAINT summaries_language_check,
  ADD CONSTRAINT summaries_language_check CHECK (language IN ('en', 'ko'));

ALTER TABLE search_documents
  DROP CONSTRAINT search_documents_language_check,
  ADD CONSTRAINT search_documents_language_check CHECK (language IN ('en', 'ko'));
