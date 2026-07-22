-- Prompt Workbench — snippet-level note.
--
-- Region notes stay prompt-local (inside the prompts.regions JSONB). This
-- column is the snippet's OWN annotation: editable only when the snippet doc
-- is open, surfaced read-only in the inspector of any prompt whose region
-- links this snippet (one-way rollup — to edit it you open the snippet).

alter table public.snippets
  add column if not exists note text not null default '';
