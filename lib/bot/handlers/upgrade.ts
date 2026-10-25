import { buildUpgradeReply as buildCanonicalUpgradeReply } from './whatsapp-premium'

// Keep every legacy "upgrade" intent on the same canonical pricing surface used
// by the live WhatsApp menu and Razorpay checkout. This handler intentionally
// owns no prices so ₹ values cannot drift here again.
export function buildUpgradeReply() {
  return buildCanonicalUpgradeReply()
}
