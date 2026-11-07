-- Workout descriptions that were only a provenance stamp.
--
-- scripts/import-workouts.mjs filled a missing description with the pack's
-- name ("Adaptive Athlete Follow-up v2 workout."), and the app showed it to
-- athletes as if it described the session. It says nothing about the training,
-- so it is cleared: a template with no description shows none. The authoring
-- source and the seed carry NULL for these rows from now on, and the importer
-- no longer writes the stamp.
update content.workout_templates
   set description = null
 where description ~ '^Adaptive Athlete\M.*\mv[0-9]+( workout)?\.?$';
