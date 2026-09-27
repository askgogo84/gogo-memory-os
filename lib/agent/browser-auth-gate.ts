export type BrowserPageModel = {
  url?: string
  title?: string
  text?: string
  forms?: Array<{
    action?: string
    method?: string
    inputs?: Array<{ selector?: string; name?: string; type?: string; label?: string }>
  }>
}

export type HumanAuthGate = {
  required: boolean
  reason?: 'password' | 'otp' | 'passkey' | 'captcha' | 'device_approval' | 'payment_auth'
  message?: string
}

function inputText(input: any) {
  return `${input?.name || ''} ${input?.type || ''} ${input?.label || ''}`.toLowerCase()
}

function normalizeAuthText(text: string) {
  return text.toLowerCase().slice(0, 22000).replace(/\r\n?/g, '\n').split(/\n\s*\n/)
    .map(paragraph => paragraph.replace(/\s+/g, ' ')).join('\n\n')
}

/**
 * Detect pages where continuing safely requires a human-only authentication step.
 * This intentionally examines only field metadata and visible page copy — never
 * field values. The result is used to PAUSE the run, not to ask a model to solve
 * or infer credentials.
 */
export function detectHumanAuthGate(page: BrowserPageModel): HumanAuthGate {
  const titleText = normalizeAuthText(page?.title || '')
  const bodyText = normalizeAuthText(page?.text || '')
  const promptText = `${titleText} ${bodyText}`.slice(0, 22000)
  // Retain the existing whitespace-insensitive checks for other auth boundaries.
  const text = promptText.replace(/\s+/g, ' ')
  const inputs = (page?.forms || []).flatMap(form => Array.isArray(form.inputs) ? form.inputs : [])
  const descriptors = inputs.map(inputText)

  const hasPasswordField = descriptors.some(x => /\bpassword\b/.test(x))
  const hasOtpField = descriptors.some(x => /\b(otp|one[- ]?time|verification code|security code|authenticator code|passcode)\b/.test(x))
  const hasPaymentAuthField = descriptors.some(x => /\b(cvv|cvc|3d secure|3ds|bank otp|card otp)\b/.test(x))
  const hasLoginCopy = /\b(sign in|log in|login|verify your identity|verify it'?s you|authentication required|enter your password)\b/.test(text)
  const hasOtpCopy = /\b(one[- ]?time password|verification code|enter (?:the )?code|we sent (?:you )?a code|authenticator app)\b/.test(text)
  const hasPasskey = /\b(passkey|security key|use your device|windows hello|touch id|face id)\b/.test(text)
  const hasCaptcha = /\b(captcha|i'?m not a robot|verify you are human|human verification)\b/.test(text)
  const hasExplicitDeviceApproval = [titleText, bodyText].some(copy => /\bapprove (?:this )?(?:sign[- ]?in|login)\b/.test(copy))
  // A bare login/navigation label is not evidence of an active auth prompt.
  // Require actionable auth copy within the same short passage as a device cue;
  // never combine independent matches from across the inspected page.
  const authPrompts = [...promptText.matchAll(/\b(?:(?:sign[- ]?in|log in|login) (?:to continue|to your account|required)|(?:trying|attempting) to (?:sign[- ]?in|log in)|verify your identity|verify it['’]?s you|authentication required|enter your password)\b/g)]
  // An auth-specific document title is stronger than an in-page navigation link.
  if (/^(?:sign[- ]?in|log in|login)(?:\s*[-–—|:]\s*\S.*)?$/i.test(page.title?.trim() || '')) {
    const titlePrompt = /^\s*(?:sign[- ]?in|log in|login)\b/.exec(promptText)
    if (titlePrompt) authPrompts.push(titlePrompt)
  }
  const deviceCues = [...promptText.matchAll(/\b(new device|check your (?:phone|device)|tap (?:yes|approve)|approve (?:it )?on your (?:phone|device)|we sent (?:a )?(?:notification|prompt) to your (?:phone|device))\b/g)]
  const hasNearbyDeviceApproval = authPrompts.some(auth => deviceCues.some(device => {
    const first = auth.index! < device.index! ? auth : device
    const second = first === auth ? device : auth
    const gap = promptText.slice(first.index! + first[0].length, second.index!)
    return gap.length <= 160 && !/\n\s*\n/.test(gap)
  }))
  const hasDeviceApproval = hasExplicitDeviceApproval || hasNearbyDeviceApproval
  const hasPaymentAuth = /\b(3d secure|3ds|bank authentication|confirm this payment|approve this payment)\b/.test(text)

  if (hasPaymentAuthField || hasPaymentAuth) {
    return { required:true, reason:'payment_auth', message:'Payment authentication needs you to take over securely.' }
  }
  if (hasOtpField || hasOtpCopy) {
    return { required:true, reason:'otp', message:'A one-time verification step needs you to take over securely.' }
  }
  if (hasPasskey) {
    return { required:true, reason:'passkey', message:'This site requires a passkey or device authentication.' }
  }
  if (hasDeviceApproval) {
    return { required:true, reason:'device_approval', message:'Approve this sign-in on your trusted device, then Gogo can continue the same task.' }
  }
  if (hasCaptcha) {
    return { required:true, reason:'captcha', message:'This site requires human verification.' }
  }
  if (hasPasswordField && hasLoginCopy) {
    return { required:true, reason:'password', message:'This site requires a human sign-in.' }
  }
  return { required:false }
}
