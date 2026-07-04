/**
 * Deterministic field ↔ data matching (PRD §11 acceptance: map labels/
 * placeholders/ARIA/name to provided JSON data with confidence scores). No LLM.
 */
import type { DataLeaf } from './data.js';

export interface FieldInfo {
  label: string;
  name: string;
  placeholder: string;
  type: string;
}

/** Synonym groups: field vocabulary → canonical key that data keys also map to. */
const SYNONYMS: Record<string, string[]> = {
  email: ['email', 'emailaddress', 'mail', 'youremail'],
  name: ['name', 'fullname', 'yourname', 'contactname'],
  firstname: ['firstname', 'fname', 'givenname', 'first'],
  lastname: ['lastname', 'lname', 'surname', 'familyname', 'last'],
  phone: ['phone', 'tel', 'telephone', 'mobile', 'cell', 'phonenumber'],
  company: ['company', 'organization', 'organisation', 'business', 'employer', 'companyname'],
  message: ['message', 'comments', 'comment', 'notes', 'details', 'inquiry', 'enquiry', 'body'],
  subject: ['subject', 'topic', 'regarding'],
  address: ['address', 'street', 'streetaddress', 'address1'],
  city: ['city', 'town'],
  state: ['state', 'province', 'region'],
  zip: ['zip', 'zipcode', 'postal', 'postalcode', 'postcode'],
  country: ['country', 'nation'],
  website: ['website', 'url', 'site', 'web', 'homepage'],
  title: ['title', 'jobtitle', 'role', 'position'],
};

export function normalize(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Map a normalized token to its canonical synonym key (or itself). */
export function canonical(norm: string): string {
  for (const [canon, syns] of Object.entries(SYNONYMS)) {
    if (canon === norm || syns.includes(norm)) return canon;
  }
  return norm;
}

export interface FieldMatch {
  path?: string;
  confidence: number;
  /** A close runner-up, if any — used to flag ambiguous mappings. */
  runnerUp?: { path: string; confidence: number };
}

/** Best data path for a field, with a confidence in [0,1]. */
export function matchField(field: FieldInfo, leaves: readonly DataLeaf[]): FieldMatch {
  const forms = [field.label, field.name, field.placeholder].map(normalize).filter(Boolean);
  if (forms.length === 0 || leaves.length === 0) return { confidence: 0 };
  const fieldCanons = new Set(forms.map(canonical));

  const scored = leaves
    .map((leaf) => {
      const leafKey = normalize(leaf.path.split('.').pop() ?? leaf.path);
      const leafCanon = canonical(leafKey);
      let s = 0;
      if (forms.includes(leafKey)) s = 0.98;
      else if (fieldCanons.has(leafCanon)) s = 0.95;
      else if (forms.some((f) => f === leafCanon)) s = 0.9;
      else if (forms.some((f) => f.includes(leafKey) || leafKey.includes(f))) s = 0.78;
      else if (fieldCanons.has(leafKey) || forms.some((f) => canonical(f) === leafCanon)) s = 0.7;
      return { path: leaf.path, confidence: s };
    })
    .sort((a, b) => b.confidence - a.confidence);

  const best = scored[0];
  if (!best || best.confidence === 0) return { confidence: 0 };
  const result: FieldMatch = { path: best.path, confidence: best.confidence };
  const second = scored[1];
  if (second && second.confidence > 0) result.runnerUp = { path: second.path, confidence: second.confidence };
  return result;
}

/** Below this, treat a field as unmatched (no confident data). */
export const MATCH_THRESHOLD = 0.55;
