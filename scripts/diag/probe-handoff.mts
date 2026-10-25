import { Sandbox } from "@vercel/sandbox"
import { browserSandboxNameFor } from "@/lib/agent/secure-browser-bootstrap"
import { supabaseAdmin } from "@/lib/data/supabase-admin"

const { data } = await supabaseAdmin.from("agent_runs")
  .select("telegram_id").eq("type","train_research").order("updated_at",{ascending:false}).limit(1)
const tg = String((data as any)?.[0]?.telegram_id || "")
const { data: u } = await supabaseAdmin.from("users").select("id").eq("telegram_id", Number(tg)).maybeSingle()
const name = browserSandboxNameFor(String((u as any)?.id))
console.log("sandbox:", name)

const sandbox = await Sandbox.get({ sandboxId: name } as any).catch(async () => null)
if (!sandbox) { console.log("could not attach by name; try the dashboard Activity tab instead"); process.exit(0) }

const probe = await (sandbox as any).runCommand({ cmd: "bash", args: ["-lc",
  "echo PWD=$(pwd); echo HOME=$HOME; echo ---LOG---; cat /home/vercel-sandbox/gogo-handoff.log 2>&1 | tail -40; echo ---PS---; ps aux | grep -i gogo-handoff | grep -v grep; echo ---PORT---; (ss -lntp 2>/dev/null || netstat -lntp 2>/dev/null) | grep 3001; echo ---FILES---; ls -la /home/vercel-sandbox 2>&1 | head -20; ls -la /vercel 2>&1 | head -20"] })
console.log(await probe.stdout())
console.log("stderr:", await probe.stderr())
