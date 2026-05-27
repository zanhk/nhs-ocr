export const PROMPT_VERSION = "v1";

export const TR1_FIELD_NAMES = [
  "title_number",
  "property",
  "date",
  "transferor",
  "transferee_for_entry_in_register",
  "transferee_address_for_service",
  "consideration_money",
  "consideration_money_sum_received",
  "consideration_other",
  "declaration_of_trust_joint_tenants",
  "declaration_of_trust_tenants_in_common",
  "declaration_of_trust_other",
  "execution_name_of_transferors",
  "execution_signature_of_transferors",
  "execution_signature_of_witness_to_transferor",
  "execution_name_of_witness_to_transferor",
  "execution_address_of_witness_to_transferor",
  "comments",
] as const;

export type TR1FieldName = (typeof TR1_FIELD_NAMES)[number];

export type TR1DataType =
  | "string"
  | "date"
  | "currency"
  | "boolean"
  | "array";

export interface TR1FieldExtracted {
  field_name: string;
  value: string | null;
  data_type: TR1DataType;
  source_page: number;
  source_section: string;
  confidence_score: number;
  is_handwritten: boolean;
  ambiguity_reason?: string | null;
}

export interface TR1FieldEnriched extends TR1FieldExtracted {
  requires_human_review: boolean;
}

export type TR1Extracted = Record<TR1FieldName, TR1FieldExtracted>;
export type TR1Enriched = Record<TR1FieldName, TR1FieldEnriched>;

const FIELD_HINTS: Record<TR1FieldName, { dataType: TR1DataType; hint: string }> = {
  title_number: {
    dataType: "string",
    hint: "Land Registry title number, panel 1. Usually alphanumeric (e.g. YRG864814).",
  },
  property: {
    dataType: "string",
    hint: "Full postal address of the property being transferred, panel 2.",
  },
  date: {
    dataType: "date",
    hint: "Date of transfer, panel 3. Format ISO 8601 YYYY-MM-DD.",
  },
  transferor: {
    dataType: "string",
    hint: "Full name(s) of the transferor(s), panel 4. Multiple names joined with ' and '.",
  },
  transferee_for_entry_in_register: {
    dataType: "string",
    hint: "Full name(s) of the transferee(s) as shown for entry in the register, panel 5.",
  },
  transferee_address_for_service: {
    dataType: "string",
    hint: "Address(es) for service of the transferee(s), panel 6.",
  },
  consideration_money: {
    dataType: "currency",
    hint: "Monetary consideration, panel 8. Include currency symbol (e.g. £906,000.00). Null if not money.",
  },
  consideration_money_sum_received: {
    dataType: "boolean",
    hint: "Whether the transferor confirms receipt of the consideration sum, panel 8. 'Yes' or 'No'.",
  },
  consideration_other: {
    dataType: "string",
    hint: "Non-monetary consideration text from panel 8, if applicable. Null otherwise.",
  },
  declaration_of_trust_joint_tenants: {
    dataType: "boolean",
    hint: "Box ticked for 'hold the property on trust for themselves as joint tenants', panel 11. 'Yes' or null.",
  },
  declaration_of_trust_tenants_in_common: {
    dataType: "boolean",
    hint: "Box ticked for 'tenants in common in equal shares', panel 11. 'Yes' or null.",
  },
  declaration_of_trust_other: {
    dataType: "string",
    hint: "Alternative trust declaration text from panel 11, if neither standard box is ticked. Null otherwise.",
  },
  execution_name_of_transferors: {
    dataType: "string",
    hint: "Printed name(s) of the transferor(s) in the execution panel (12). Null if only signed.",
  },
  execution_signature_of_transferors: {
    dataType: "string",
    hint: "Signature(s) of the transferor(s) in the execution panel (12). Typically handwritten.",
  },
  execution_signature_of_witness_to_transferor: {
    dataType: "string",
    hint: "Signature of the witness in the execution panel (12). Typically handwritten.",
  },
  execution_name_of_witness_to_transferor: {
    dataType: "string",
    hint: "Printed name of the witness in the execution panel (12).",
  },
  execution_address_of_witness_to_transferor: {
    dataType: "string",
    hint: "Address of the witness in the execution panel (12).",
  },
  comments: {
    dataType: "string",
    hint: "Any extra notes/observations about the document not captured above. Null if none.",
  },
};

const fieldSchema = (dataType: TR1DataType) => ({
  type: "OBJECT",
  properties: {
    field_name: { type: "STRING" },
    value: { type: "STRING", nullable: true },
    data_type: {
      type: "STRING",
      enum: ["string", "date", "currency", "boolean", "array"],
    },
    source_page: { type: "INTEGER" },
    source_section: { type: "STRING" },
    confidence_score: { type: "NUMBER" },
    is_handwritten: { type: "BOOLEAN" },
    ambiguity_reason: { type: "STRING", nullable: true },
  },
  required: [
    "field_name",
    "value",
    "data_type",
    "source_page",
    "source_section",
    "confidence_score",
    "is_handwritten",
  ],
  propertyOrdering: [
    "field_name",
    "value",
    "data_type",
    "source_page",
    "source_section",
    "confidence_score",
    "is_handwritten",
    "ambiguity_reason",
  ],
  description: `Expected data_type: ${dataType}`,
});

export const TR1_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: Object.fromEntries(
    TR1_FIELD_NAMES.map((name) => [name, fieldSchema(FIELD_HINTS[name].dataType)]),
  ),
  required: [...TR1_FIELD_NAMES],
  propertyOrdering: [...TR1_FIELD_NAMES],
};

export const TR1_PROMPT = `You are extracting structured data from a UK Land Registry Form TR1 (Transfer of Whole of Registered Title(s)). The document may be a scanned PDF or photograph, and may contain handwritten signatures, names, addresses, and ticked boxes.

For EVERY field listed below, return an object with these keys:
- field_name: the exact field key (e.g. "title_number")
- value: the extracted value as a string, or null if not present. For booleans use "Yes"/"No"; for dates use ISO 8601 YYYY-MM-DD; for currency include the symbol (e.g. £906,000.00).
- data_type: one of "string" | "date" | "currency" | "boolean" | "array" — use the type hint per field below.
- source_page: the 1-indexed page number where the field appears (1 if single-page).
- source_section: the panel name or heading text where the field was found (e.g. "Panel 1 — Title Number(s)", "Panel 12 — Execution").
- confidence_score: a number from 0.0 to 1.0 representing how confident you are in the extracted value. Be honest: low resolution, ambiguous handwriting, multiple candidates, or unclear ticks should reduce the score.
- is_handwritten: true if the value was written by hand (cursive, signature, hand-printed), false if it is machine-printed.
- ambiguity_reason: a SHORT string (under 80 chars) describing any uncertainty (e.g. "signature illegible", "two names overlap", "box partially ticked"). Use null when there is none.

Field guide:
${TR1_FIELD_NAMES.map((n) => `- ${n} [${FIELD_HINTS[n].dataType}]: ${FIELD_HINTS[n].hint}`).join("\n")}

Rules:
1. If a field is genuinely absent from the document, set value to null but still return the object with your best guess for data_type, source_page and source_section (where it WOULD be on a TR1), and confidence_score reflecting that absence (e.g. 0.95 if cleanly blank, 0.4 if you're not sure whether it's blank or unreadable).
2. Never invent values. Prefer null + low confidence over a guess.
3. For the boolean trust-declaration fields (joint_tenants / tenants_in_common / other), set value to "Yes" only if the box is clearly ticked; null otherwise.
4. For signatures, transcribe the closest readable rendering you can in value; raise is_handwritten=true and lower confidence_score accordingly.
5. The comments field is for the EXTRACTOR's notes about the document overall (e.g. "Document is page 2 of 3, panel 11 cut off"), not the form's own text.

Return ONLY the JSON object matching the schema. No prose, no markdown, no preamble.`;
