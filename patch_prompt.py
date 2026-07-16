import io, os, sys
p = os.path.join(os.getcwd(), "lib/services/claude.ts")
raw = io.open(p, encoding="utf-8").read()
crlf = "\r\n" in raw
t = raw.replace("\r\n", "\n")
OLD = "CRITICAL: Calculate datetime yourself. Never ask follow-up questions about time or message."
NEW = ("CRITICAL: When the user gives a time or date, calculate the exact datetime yourself and output the REMINDER line. "
       "If the user gives NO time or date (e.g. \"remind me about the thing\"), do NOT guess a time and do NOT output a "
       "REMINDER line - instead reply in one short sentence asking when. The [message] field must be a short clean task "
       "label only (e.g. \"Call the bank\") - never include words like \"today\", \"tomorrow\", \"at 1pm\", or \"day after\".")
if NEW.split(".")[0] in t and OLD not in t:
    print("= already applied, skipping"); sys.exit(0)
if t.count(OLD) != 1: sys.exit(f"! anchor found {t.count(OLD)}x. ABORT.")
t = t.replace(OLD, NEW, 1)
io.open(p, "w", encoding="utf-8", newline="").write(t.replace("\n","\r\n") if crlf else t)
print("+ reminder prompt: ask when no time given; clean message label")
