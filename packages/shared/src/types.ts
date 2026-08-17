// Shared domain types — mirror the Supabase schema (0001_init.sql).
// Imported by the web app, the mobile app and the backend so the whole
// system speaks one language.

export type UserRole = 'admin' | 'office' | 'surveyor' | 'scanner' | 'fitter';
export type ItemStage = 'scanned' | 'in_survey' | 'surveyed' | 'synced';
export type InstallStatus =
  | 'scheduled' | 'installed_no_snag' | 'installed_snag' | 'snag' | 'misfit' | 'delayed';
export type PhotoKind = 'reference' | 'survey' | 'sketch' | 'install';
export type ConnectorType =
  | 'monday' | 'procore' | 'fieldwire' | 'csv' | 'clearview' | 'glass_supplier';

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  coding_scheme: { segments: string[]; separator: string };
  branding: { primary: string; accent: string };
  created_at: string;
}

export interface AppUser {
  id: string;
  tenant_id: string;
  auth_user_id: string | null;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  created_at: string;
}

export interface Job {
  id: string;
  tenant_id: string;
  client_code: string;          // AXS
  job_code: string;             // LAB
  name: string;
  site_address: string | null;
  monday_board_id: string | null;
  monday_account_slug: string | null;   // e.g. "ace189144" — makes item links resolve to the right account
  active: boolean;
  created_at: string;
}

export interface FitterTeam {
  id: string;
  tenant_id: string;
  name: string;
  default_rate_pennies: number; // £80.00 = 8000
  created_at: string;
}

export interface StyleCatalogueRow {
  id: string;
  tenant_id: string | null;     // null = global catalogue
  source: string;               // 'clearview'
  style_number: string;         // used as Design Code
  product_type: string | null;
  wide: number | null;
  high: number | null;
  opening: number | null;
  fixed: number | null;
  drawing_path: string | null;
  notes: string | null;
}

export interface SurveyItem {
  id: string;
  tenant_id: string;
  job_id: string;

  // location / identity
  block: string | null;
  elevation: string | null;
  flat: string | null;
  room_code: string | null;
  item_code: string | null;     // W01 / D01
  floor: string | null;
  full_code: string | null;

  // specification
  material: string | null;
  item_type: string | null;
  glass: string | null;
  safety_glass: string | null;
  glazing: string | null;
  width_mm: number | null;
  height_mm: number | null;
  cill_depth_mm: number | null;
  transom1_mm: number | null; transom2_mm: number | null; transom3_mm: number | null;
  mullion1_mm: number | null; mullion2_mm: number | null; mullion3_mm: number | null;
  open_in_out: string | null;
  add_ons: string | null;
  coupled: string | null;
  design_code: string | null;   // Clearview style number
  comments: string | null;

  // workflow
  stage: ItemStage;
  surveyed_by: string | null;
  scanned_by: string | null;

  // install / labour
  team_id: string | null;
  rate_override_pennies: number | null;  // null = inherit team default
  install_status: InstallStatus | null;

  // snags-as-items
  kind: 'item' | 'snag';
  parent_item_id: string | null;   // set on snag items -> the original item
  snag_comment: string | null;

  // integration
  monday_item_id: string | null;

  created_at: string;
  updated_at: string;
}

export interface ItemPhoto {
  id: string;
  tenant_id: string;
  item_id: string;
  kind: PhotoKind;
  storage_path: string;
  taken_at: string | null;
  gps_lat: number | null;
  gps_lng: number | null;
  monday_pushed?: boolean;
  created_at: string;
}

export interface Snag {
  id: string;
  tenant_id: string;
  item_id: string;
  description: string;
  photo_path: string | null;
  status: string;
  monday_subitem_id: string | null;
  created_at: string;
}

export interface PickEvent {
  id: string;
  tenant_id: string;
  item_id: string | null;
  style_number: string;
  job_id: string | null;
  room_code: string | null;
  surveyor_id: string | null;
  created_at: string;
}

export interface Connector {
  id: string;
  tenant_id: string;
  type: ConnectorType;
  config: Record<string, unknown>;
  active: boolean;
  created_at: string;
}
