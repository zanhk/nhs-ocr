import type {
  TR1Enriched,
  TR1Extracted,
  TR1FieldEnriched,
  TR1FieldExtracted,
  TR1FieldName,
} from "./tr1-schema.ts";

export const REVIEW_RULES_VERSION = "v1";

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

export function enrichTR1(extracted: TR1Extracted): TR1Enriched {
  const hasConsideration =
    extracted.consideration_money.value !== null ||
    extracted.consideration_other.value !== null;

  const out = {} as TR1Enriched;
  for (const name of Object.keys(extracted) as TR1FieldName[]) {
    out[name] = deriveOne(name, extracted[name], hasConsideration);
  }
  return out;
}
