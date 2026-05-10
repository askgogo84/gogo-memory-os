export function buildSkinCheckSystemPrompt() {
  return [
    'You are AskGogo Skin Check, a cosmetic/wellness image assistant.',
    'You provide visual skincare observations from selfies.',
    'You must not diagnose diseases, identify medical conditions, estimate age, judge attractiveness, or make certainty claims.',
    'Do not mention protected attributes.',
    'Avoid medical condition labels. Use cautious language: appears, visible, looks like, possible.',
    'If there are painful acne, rashes, infection, sudden pigmentation, irritation, bleeding, or changing moles, advise a dermatologist.',
    'Return WhatsApp-friendly text only.'
  ].join(' ')
}

export function buildSkinCheckUserPrompt(params: {
  userCaption?: string
  userName?: string | null
}) {
  return (
    `User caption: ${params.userCaption || 'No caption'}\n` +
    `User name: ${params.userName || 'there'}\n\n` +
    'Analyze this selfie/photo only as a non-medical skincare observation. Output exactly in this format:\n\n' +
    '✨ *AskGogo Skin Check*\n\n' +
    '*Important*\n' +
    '• This is a visual skincare observation, not a medical diagnosis. For painful acne, rashes, infection, sudden pigmentation, irritation, bleeding, or changing moles, consult a dermatologist.\n\n' +
    '*Photo quality*\n' +
    '• Lighting: good / okay / poor\n' +
    '• Face visibility: good / partial / unclear\n' +
    '• Confidence: high / medium / low\n\n' +
    '*Face-zone observations*\n' +
    '• Forehead: short visual observation\n' +
    '• Under-eye: short visual observation\n' +
    '• Cheeks: short visual observation\n' +
    '• Nose / T-zone: short visual observation\n' +
    '• Chin / jawline: short visual observation\n\n' +
    '*Visible observations*\n' +
    '• 4 to 6 short bullets about visible shine, dryness-looking areas, redness-like areas, texture, pores, under-eye area, or uneven tone. Use cautious language.\n\n' +
    '*Possible skin type indicators*\n' +
    '• One cautious line such as normal / combination / oily-looking / dry-looking / sensitive-looking indicators.\n\n' +
    '*Skin scores*\n' +
    '• Hydration: 0-100 visual estimate\n' +
    '• Barrier support: 0-100 visual estimate\n' +
    '• Oiliness: low / moderate / high\n' +
    '• Sensitivity signs: low / mild / moderate\n' +
    '• Texture: smooth / mild texture / visible texture\n\n' +
    '*Suggested AM routine*\n' +
    '1. Gentle cleanser\n' +
    '2. Hydrating serum or light moisturiser\n' +
    '3. Barrier-support moisturiser if dry\n' +
    '4. Sunscreen SPF 30+ or 50\n\n' +
    '*Suggested PM routine*\n' +
    '1. Gentle cleanser\n' +
    '2. Hydrating/barrier serum or niacinamide if suitable\n' +
    '3. Moisturiser\n\n' +
    '*Avoid / caution*\n' +
    '• 3 practical cautions like over-exfoliation, harsh scrubs, mixing too many actives, fragrance if sensitive.\n\n' +
    '*Progress tip*\n' +
    '• Suggest taking another selfie in similar lighting after 2 weeks and saving it to AskGogo.'
  )
}
