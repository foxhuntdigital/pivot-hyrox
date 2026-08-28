-- Running becomes a real equipment constraint.
--
-- The engine used to treat `outdoor` as always available (BODYWEIGHT in
-- packages/engine/src/guardrails.ts), which read as generosity and was in fact
-- a hole: `requires_running` could never be filtered. An athlete in a hotel
-- room, or a home gym with no treadmill, was still handed run sessions and no
-- equipment profile could say otherwise. Running now costs `treadmill` or
-- `outdoor` the way every other modality costs its kit.
--
-- That reinterprets existing rows rather than changing them. A profile written
-- before this migration was answered under the old rule, where leaving both
-- unticked still meant "I can run" — so an athlete who never thought about it
-- would lose every run session the moment the engine shipped. The old
-- behaviour is therefore made explicit: every existing default profile that
-- claims neither gets `outdoor`, which is what it already meant.
--
-- Only profiles that name no running surface are touched. One that says
-- `treadmill` and not `outdoor` was a deliberate answer under the old rule too
-- — the athlete listed their kit — and is left exactly as it is.

insert into public.equipment_profile_items (profile_id, equipment_id)
select ep.id, 'outdoor'
from public.equipment_profiles ep
where not exists (
  select 1 from public.equipment_profile_items i
  where i.profile_id = ep.id
    and i.equipment_id in ('outdoor', 'treadmill')
)
on conflict (profile_id, equipment_id) do nothing;
