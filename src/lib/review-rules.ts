import type {
  TR1Enriched,
  TR1Extracted,
  TR1FieldEnriched,
  TR1FieldExtracted,
  TR1FieldName,
} from "./tr1-schema.ts";

export const REVIEW_RULES_VERSION = "v2";

const CONFIDENCE_FLOOR = 0.7;

const ALWAYS_REQUIRED: TR1FieldName[] = [
  "title_number",
  "property",
  "date",
  "transferor",
  "transferee_for_entry_in_register",
];

const HANDWRITING_SENSITIVE: TR1FieldName[] = [
  "execution_signature_of_transferors",
  "execution_signature_of_witness_to_transferor",
  "execution_name_of_witness_to_transferor",
  "execution_address_of_witness_to_transferor",
];

const TRUST_FIELDS: TR1FieldName[] = [
  "declaration_of_trust_joint_tenants",
  "declaration_of_trust_tenants_in_common",
  "declaration_of_trust_other",
];

function deriveOne(
  name: TR1FieldName,
  f: TR1FieldExtracted,
  hasConsideration: boolean,
): TR1FieldEnriched {
  let review = false;
  if (typeof f.confidence_score !== "number" || f.confidence_score < CONFIDENCE_FLOOR) {
    review = true;
  }
  if (f.is_handwritten && HANDWRITING_SENSITIVE.includes(name)) {
    review = true;
  }
  if (f.value === null && ALWAYS_REQUIRED.includes(name)) {
    review = true;
  }
  if (
    f.value === null &&
    (name === "consideration_money" || name === "consideration_other") &&
    !hasConsideration
  ) {
    review = true;
  }
  if (f.ambiguity_reason != null && f.ambiguity_reason.length > 0) {
    review = true;
  }
  return { ...f, requires_human_review: review };
}

function looksLikeMultipleTransferees(value: string | null): boolean {
  if (!value) return false;
  // Common joiners: " and ", " & ", comma-separated names
  if (/ and /i.test(value)) return true;
  if (/ & /.test(value)) return true;
  // crude comma test: two or more commas usually means a list of people
  const commaCount = (value.match(/,/g) ?? []).length;
  if (commaCount >= 2) return true;
  return false;
}

export function enrichTR1(extracted: TR1Extracted): TR1Enriched {
  const hasConsideration =
    extracted.consideration_money.value !== null ||
    extracted.consideration_other.value !== null;

  const out = {} as TR1Enriched;
  for (const name of Object.keys(extracted) as TR1FieldName[]) {
    out[name] = deriveOne(name, extracted[name], hasConsideration);
  }

  // Cross-field rule: a multi-transferee TR1 with NO trust declaration ticked
  // will trigger a Form A restriction by default at HM Land Registry. Flag for
  // human review so the operator confirms this is intentional.
  if (looksLikeMultipleTransferees(out.transferee_for_entry_in_register.value)) {
    const allTrustNull = TRUST_FIELDS.every((n) => out[n].value === null);
    if (allTrustNull) {
      for (const n of TRUST_FIELDS) {
        out[n].requires_human_review = true;
        out[n].ambiguity_reason =
          out[n].ambiguity_reason ??
          "multi-transferee TR1 with no trust declaration ticked — Form A restriction will be imposed by default";
      }
    }
  }

  return out;
}

export function enrichTR1List(extractions: TR1Extracted[]): TR1Enriched[] {
  return extractions.map(enrichTR1);
}

export function countReviewFields(enriched: TR1Enriched): number {
  return Object.values(enriched).filter((f) => f.requires_human_review).length;
}
