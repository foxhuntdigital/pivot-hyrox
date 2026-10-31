/**
 * The equipment an athlete can choose from, as the server holds it.
 *
 * Read from `content.equipment` for the same reason onboarding reads it there:
 * what an athlete can tick is then exactly what the planner can select
 * against. The bundled catalogue stands in until the read lands, and for good
 * if it fails or there is no server, and `offline` says which is showing.
 * One read per app run, shared by every screen that asks.
 */
import { useEffect, useState } from 'react';

import { EQUIPMENT, visibleEquipment } from '@/data/content';
import { fetchEquipment, type EquipmentOption } from '@/data/planRepo';

const bundled: EquipmentOption[] = visibleEquipment(EQUIPMENT);
let catalogue: { choices: EquipmentOption[]; offline: boolean } | null = null;
let inflight: Promise<void> | null = null;

function load(): Promise<void> {
  inflight ??= fetchEquipment()
    .then(list => {
      catalogue = list.length
        ? { choices: visibleEquipment(list), offline: false }
        : { choices: bundled, offline: true };
    })
    .catch(e => {
      console.warn('[profile] equipment fetch failed, using bundled catalogue:', e);
      catalogue = { choices: bundled, offline: true };
    })
    .finally(() => { inflight = null; });
  return inflight;
}

export function useEquipmentCatalogue(): { choices: EquipmentOption[]; offline: boolean } {
  const [state, setState] = useState(catalogue ?? { choices: bundled, offline: false });
  useEffect(() => {
    let live = true;
    if (catalogue) { setState(catalogue); return; }
    load().then(() => { if (live && catalogue) setState(catalogue); });
    return () => { live = false; };
  }, []);
  return state;
}
