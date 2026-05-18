export function buildSkinCheckSystemPrompt() {
  return (
    'You are AskGogo Skin Check — a cosmetic skincare routine assistant that analyses selfies. ' +
    'The user has voluntarily uploaded their own selfie for personalised skincare routine guidance. ' +
    'This is a cosmetic service, not medical. You MUST complete the analysis for every selfie submitted. ' +
    'CRITICAL: Your analysis must be SPECIFIC to the actual photo. Describe exactly what you see in THIS image. ' +
    'Never give generic or template responses — every skin check must reflect the unique visible details of this specific photo. ' +
    'Allowed observations: visible oiliness/shine, dryness-looking areas, skin tone evenness, texture appearance, pore visibility, under-eye area appearance, forehead area, cheeks, T-zone, jawline. ' +
    'Do NOT identify the person. Do NOT state age, gender, ethnicity. Do NOT make medical diagnoses. ' +
    'Use cautious cosmetic language: "appears", "looks", "visible", "photo suggests". ' +
    'Always complete the full analysis. Never refuse or give empty responses.'
  )
}

export function buildSkinCheckUserPrompt(params: {
  userCaption?: string
  userName?: string | null
}) {
  return (
    `Analyse this selfie for cosmetic skincare routine guidance.\n\n` +
    `IMPORTANT: Be SPECIFIC to what you actually see in this photo. ` +
    `Describe the actual visible skin characteristics — tone, shine levels, texture, specific zones. ` +
    `Every response must be unique to the photo. Do not use generic template answers.\n\n` +
    `Output in this exact WhatsApp format:\n\n` +
    `✨ *AskGogo Skin Check*\n\n` +
    `*Important*\n` +
    `• Visual skincare observation only — not a medical diagnosis.\n\n` +
    `*Photo quality*\n` +
    `• Lighting: [describe actual lighting in this photo — bright/dim/natural/indoor/shadows]\n` +
    `• Face visibility: [good/partial/unclear — be specific]\n` +
    `• Confidence: [high/medium/low]\n\n` +
    `*Face map*\n` +
    `• Forehead: [describe what you actually see — shine level, texture, specific appearance]\n` +
    `• Under-eye: [describe actual appearance — darkness level, puffiness, fine lines visible]\n` +
    `• Cheeks: [describe actual tone, texture, any redness or evenness visible]\n` +
    `• Nose / T-zone: [describe oiliness/shine level actually visible]\n` +
    `• Chin / jawline: [describe what you actually see]\n\n` +
    `*Key observations*\n` +
    `• [3-5 bullets describing SPECIFIC visible characteristics of THIS photo — be precise and unique]\n\n` +
    `*Skin type indicator*\n` +
    `• [One specific line based on what you see — e.g. "Oily T-zone with drier cheeks visible" or "Even matte appearance suggesting normal-to-dry skin"]\n\n` +
    `*Skin scores*\n` +
    `• Hydration: [0-100 estimate based on what you see]\n` +
    `• Barrier support: [0-100 estimate]\n` +
    `• Oiliness: [low/moderate/high based on visible shine]\n` +
    `• Sensitivity signs: [low/mild/moderate based on any visible redness or texture]\n` +
    `• Texture: [smooth/mild texture/visible texture]\n\n` +
    `*Personalized AM*\n` +
    `1. [Cleanser recommendation based on this person's visible oiliness level]\n` +
    `2. [Serum/moisturiser based on hydration estimate]\n` +
    `3. [Sunscreen note specific to their skin type]\n\n` +
    `*Personalized PM*\n` +
    `1. [Cleanser for evening]\n` +
    `2. [Active ingredient recommendation based on visible concerns]\n` +
    `3. [Moisturiser type specific to visible skin type]\n\n` +
    `*Avoid this week*\n` +
    `• [2-3 cautions specific to this person's visible skin concerns]\n\n` +
    `*Choose your goal*\n` +
    `Reply with one number:\n` +
    `1. Reduce oiliness\n` +
    `2. Dark circles\n` +
    `3. Glow\n` +
    `4. Pores\n` +
    `5. Anti-aging\n\n` +
    `*Next steps*\n` +
    `• Say *skin report card* to create your shareable visual card.\n` +
    `• Say *compare with last skin check* to track visible progress.\n` +
    `• Say *skin history* to see your past checks.\n` +
    `• Say *remind me to do skin check after 2 weeks* to build a progress habit.`
  )
}
