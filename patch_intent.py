import io, os, sys
path = os.path.join(os.getcwd(), "lib/bot/detect-intent.ts")
raw = io.open(path, encoding="utf-8").read()
crlf = "\r\n" in raw
t = raw.replace("\r\n", "\n")
OLD = ("  if (lower === 'pricing' || lower === 'price' || lower === 'plans' || lower === 'plan' || "
       "lower === 'upgrade' || lower === '/upgrade' || lower === 'payment' || lower === 'payments' || "
       "lower.includes('razorpay') || lower.includes('paid plan') || lower.includes('subscribe')) "
       "return { type: 'upgrade_plan', confidence: 'high' }")
NEW = ("  if (lower === 'pricing' || lower === 'price' || lower === 'plans' || lower === 'plan' || "
       "lower === 'upgrade' || lower === '/upgrade' || lower === 'payment' || lower === 'payments' || "
       "lower === 'subscribe' || lower === 'razorpay' || lower === 'paid plan') "
       "return { type: 'upgrade_plan', confidence: 'high' }")
if NEW in t:
    print("= already applied, skipping"); sys.exit(0)
if t.count(OLD) != 1:
    sys.exit(f"! expected exactly 1 anchor, found {t.count(OLD)}. ABORT.")
t = t.replace(OLD, NEW, 1)
io.open(path, "w", encoding="utf-8", newline="").write(t.replace("\n","\r\n") if crlf else t)
print("+ tightened upgrade_plan intent")
