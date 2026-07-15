import io, os, sys
path = os.path.join(os.getcwd(), "lib/bot/handlers/whatsapp-direct-premium.ts")
raw = io.open(path, encoding="utf-8").read()
crlf = "\r\n" in raw
t = raw.replace("\r\n", "\n")
if "AskGogo Pricing" not in t:
    print("= already applied, skipping"); sys.exit(0)
start = t.find("  if (\n    lower === 'pricing' ||")
if start < 0: sys.exit("! start anchor not found. ABORT.")
end_marker = "  // Referral commands are handled by referral-unlock.ts before this direct handler."
end = t.find(end_marker, start)
if end < 0: sys.exit("! end anchor not found. ABORT.")
removed = t[start:end]
if "Razorpay verification is in progress" not in removed or "notify me" not in removed.lower():
    sys.exit("! span sanity check failed. ABORT.")
t = t[:start] + t[end:]
out = t.replace("\n", "\r\n") if crlf else t
io.open(path, "w", encoding="utf-8", newline="").write(out)
print("+ removed stale pricing/upgrade + notify_me branches")
