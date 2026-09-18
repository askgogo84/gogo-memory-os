import { supabaseAdmin } from "@/lib/data/supabase-admin"

const { data: runs } = await supabaseAdmin.from("agent_runs")
  .select("*").eq("type","train_research").order("updated_at",{ascending:false}).limit(3)

for (const r of (runs||[]) as any[]) {
  console.log("=======================================")
  console.log(r.updated_at, "|", r.status, "|", r.id)
  console.log("ERROR:", r.error)
  console.log("SUMMARY:", r.summary)
  const m:any = r.metadata_json || {}
  console.log("META keys:", Object.keys(m).join(", "))
  console.log("state:", m.state, "| directOnly:", m.directOnly, "| handoff:", JSON.stringify(m.handoff||null).slice(0,300))
  const { data: steps } = await supabaseAdmin.from("agent_steps")
    .select("ordinal,tool_name,title,status,error,output_json").eq("run_id", String(r.id)).order("ordinal")
  for (const s of (steps||[]) as any[]) {
    console.log("  STEP", s.ordinal, s.tool_name, "|", s.status, "|", s.title)
    console.log("    error:", String(s.error||"").slice(0,300))
    console.log("    output:", JSON.stringify(s.output_json||{}).slice(0,400))
  }
}
