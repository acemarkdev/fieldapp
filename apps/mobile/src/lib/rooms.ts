// ACE room codes. Hardcoded so the picker works offline. The `QUICK` set are the
// one-tap chips shown first; the rest are reachable via the searchable "More…" list.
export interface Room { name: string; code: string; }

export const ROOMS: Room[] = [
  { name: 'Living room', code: 'LR' },
  { name: 'Kitchen', code: 'KT' },
  { name: 'Bathroom', code: 'BA' },
  { name: 'Bedroom', code: 'BD' },
  { name: 'Dining room', code: 'DR' },
  { name: 'Hallway', code: 'HW' },
  { name: 'Home office', code: 'HO' },
  { name: 'Laundry room', code: 'LA' },
  { name: 'Pantry', code: 'PA' },
  { name: 'Storage room', code: 'ST' },
  { name: 'Garage', code: 'GA' },
  { name: 'Attic', code: 'AT' },
  { name: 'Basement', code: 'BS' },
  { name: 'Guest room', code: 'GR' },
  { name: 'Nursery', code: 'NU' },
  { name: 'Master bedroom', code: 'MB' },
  { name: 'Balcony', code: 'BL' },
  { name: 'Terrace', code: 'TE' },
  { name: 'Garden', code: 'GD' },
  { name: 'Office', code: 'OF' },
  { name: 'Common Room', code: 'CR' },
  { name: 'Common Way', code: 'CW' },
];

// The handful that usually exist in a flat — shown as instant chips.
export const QUICK_ROOMS = ['LR', 'KT', 'BA', 'BD', 'HW'];

export const roomName = (code: string): string => ROOMS.find((r) => r.code === code)?.name ?? code;
