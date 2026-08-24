/** Shapes returned to the public: MCP tools, the widget and the website. */

export type SessionType = 'individual' | 'couples' | 'family';
export type SessionMode = 'online' | 'in_person';
export type AgeGroup = 'adults' | 'teens' | 'children' | 'seniors';

export interface PublicCredential {
  title: string;
  issuer: string;
  year: number | null;
  /** True only when an administrator checked the document. */
  verified: boolean;
}

/** Publiczna wizytówka terapeuty w innym serwisie. Wyłącznie https. */
export interface PublicLink {
  label: string;
  url: string;
}

export interface PublicLocation {
  city: string;
  region: string | null;
  country: string;
  address_line: string | null;
}

export interface PublicOffer {
  offer_id: string;
  title: string;
  session_type: SessionType;
  mode: SessionMode;
  duration_minutes: number;
  price_minor: number;
  currency: string;
}

export interface NamedTag {
  slug: string;
  name: string;
}

export interface PublicTherapist {
  therapist_id: string;
  slug: string;
  display_name: string;
  headline: string | null;
  bio: string;
  photo_url: string | null;
  profile_url: string;
  locations: PublicLocation[];
  offers_online: boolean;
  offers_in_person: boolean;
  languages: string[];
  topics: NamedTag[];
  modalities: NamedTag[];
  session_types: SessionType[];
  age_groups: AgeGroup[];
  accepting_new_clients: boolean;
  credentials: PublicCredential[];
  links: PublicLink[];
  verification_status: 'unverified' | 'verified' | 'rejected';
  verified_at: string | null;
  offers: PublicOffer[];
  price_min_minor: number | null;
  price_max_minor: number | null;
  currency: string;
  next_available_slot_utc: string | null;
  timezone: string;
  cancellation_policy: string;
  cancellation_cutoff_hours: number;
  /** Sections she arranged herself. Empty = the default spine above. */
  sections: unknown[];
  /** How the page is presented, as stored. Read it with `parseLayout`. */
  layout?: string;
  /** What happens at the first meeting. Any field may be empty. */
  first_meeting: { course: string; prep: string; decision: string };
  /** True for the fictional profiles shipped with the seed. Always surfaced in the UI. */
  is_demo: boolean;
}

export interface PublicFaqItem {
  faq_id: string;
  therapist_id: string;
  question: string;
  answer: string;
  category: string;
  updated_at: string;
  /** Who signed off on the wording. Present on every published item. */
  approved_at: string | null;
}

export interface PublicSlot {
  slot_id: string;
  therapist_id: string;
  offer_id: string;
  starts_at_utc: string;
  ends_at_utc: string;
  /** The appointment's own IANA zone. Preserved regardless of the viewer. */
  timezone: string;
  session_type: SessionType;
  mode: SessionMode;
  duration_minutes: number;
  price_minor: number;
  currency: string;
}

export interface CrisisResource {
  id: string;
  audience: 'all' | 'adult' | 'minor';
  title: string;
  description: string;
  phone: string | null;
  url: string | null;
  hours: string | null;
  source_url: string;
  verified_at: string;
  version: string;
}

/** Raw `therapists` row as stored. Includes fields that must never be published. */

export interface TherapistRow {
  id: string;
  slug: string;
  display_name: string;
  headline: string | null;
  bio: string;
  photo_url: string | null;
  offers_online: number;
  offers_in_person: number;
  accepting_new_clients: number;
  age_groups: string;
  session_types: string;
  credentials: string;
  links: string;
  verification_status: 'unverified' | 'verified' | 'rejected';
  verified_at: string | null;
  /** PRIVATE. Never included in any public projection. */
  verification_notes: string | null;
  status: 'draft' | 'published' | 'unpublished';
  is_demo: number;
  timezone: string;
  sections_json: string;
  layout_json: string;
  first_meeting_course: string;
  first_meeting_prep: string;
  first_meeting_decision: string;
  contact_email_enc: string | null;
  cancellation_policy: string;
  cancellation_cutoff_h: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}
