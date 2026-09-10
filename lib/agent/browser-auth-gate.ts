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
  reason?: 'password' | 'otp' | 'passkey' | 'captcha' | 'payment_auth'
  message?: string
}

function inputText(input: any) {
  return `${input?.name || ''} ${input?.type || ''} ${input?.label || ''}`.toLowerCase()
}

/**
 * Detect pages where continuing safely requires a human-only authentication step.
 * This intentionally examines only field metadata and visible page copy — never
 * field values. The result is used to PAUSE the run, not to ask a model to solve
 * or infer credentials.
 */
export function detectHumanAuthGate(page: BrowserPageModel): HumanAuthGate {
  const text = `${page?.title || ''} ${page?.text || ''}`.toLowerCase().slice(0, 22000)
  const inputs = (page?.forms || []).flatMap(form => Array.isArray(form.inputs) ? form.inputs : [])
  const descriptors = inputs.map(inputText)

  const hasPasswordField = descriptors.some(x => /\bpassword\b/.test(x))
  const hasOtpField = descriptors.some(x => /\b(otp|one[- ]?time|verification code|security code|authenticator code|passcode)\b/.test(x))
  const hasPaymentAuthField = descriptors.some(x => /\b(cvv|cvc|3d secure|3ds|bank otp|card otp)\b/.test(x))
  const hasLoginCopy = /\b(sign in|log in|login|verify your identity|verify it'?s you|authentication required|enter your password)\b/.test(text)
  const hasOtpCopy = /\b(one[- ]?time password|verification code|enter (?:the )?code|we sent (?:you )?a code|authenticator app)\b/.test(text)
  const hasPasskey = /\b(passkey|security key|use your device|windows hello|touch id|face id)\b/.test(text)
  const hasCaptcha = /\b(captcha|i'?m not a robot|verify you are human|human verification)\b/.test(text)
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
  if (hasCaptcha) {
    return { required:true, reason:'captcha', message:'This site requires human verification.' }
  }
  if (hasPasswordField && hasLoginCopy) {
    return { required:true, reason:'password', message:'This site requires a human sign-in.' }
  }
  return { required:false }
}
