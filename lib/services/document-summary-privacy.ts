// Public-facing document metadata must not expose values from OCR/extraction.
// Keep original files and structured extraction in the owner-bound private store.
export function redactDocumentMetadata(text: string | null | undefined): string {
  return String(text || '')
    .replace(/\b(?:date\s+of\s+birth|birth\s*date|d\.?o\.?b\.?)\s*(?:is\s+|[:=\-]\s*)?[^\n;,·|]+/gi, 'Date of birth: [hidden]')
    .replace(/\b(?:passport|aadhaar|aadhar|ssn|pan|document|national\s*id|identity)(?:\s*(?:number|no\.?|#))?\s*[:=#\-]?\s*[A-Z0-9][A-Z0-9 -]*\d[A-Z0-9 -]*/gi, 'ID: [hidden]')
    .replace(/\b[A-Z]\d{7}\b/gi, '[hidden]')
    .replace(/\b[A-Z]{5}\d{4}[A-Z]\b/gi, '[hidden]')
    .replace(/\b\d{4}[ -]?\d{4}[ -]?\d{4}\b/g, '[hidden]')
}

export function safeDocumentSummary(summary: string | null | undefined, docType?: string | null, extracted?: Record<string, any> | null): string {
  // Legacy rows can be misclassified as generic documents. Inspect their metadata
  // and text too; never depend on a model-provided privacy flag alone.
  const identity = /passport|id_document|identity|aadhaar|aadhar|national_id|pan_card/i
  const identityText = /\b(?:passport|aadhaar|aadhar|date\s+of\s+birth|d\.?o\.?b\.?)\b/i
  if (identity.test([docType, extracted?.assetType, extracted?.detectedAssetType].join(' '))
    || extracted?.privacyClass === 'sensitive' || identityText.test(String(summary || ''))) {
    return 'Sensitive document details are hidden.'
  }
  return redactDocumentMetadata(summary)
}
