import { supabaseAdmin } from "@/lib/data/supabase-admin"

const { data, error } = await supabaseAdmin.from("agent_runs")
  .select("*").order("updated_at", { ascending: false }).limit(6)

if (error) { console.error("QUERY FAILED:", error.message); process.exit(1) }
if (!data?.length) { console.log("NO agent_runs AT ALL"); process.exit(0) }

console.log("COLUMNS:", Object.keys(data[0] as any).join(", "))
for (const r of data as any[]) {
  console.log("---")
  console.log(r.updated_at || r.started_at, "|", r.type, "|", r.status, "|", r.title)
  console.log("  source:", r.source, "| capability:", r.capability)
  console.log("  summary:", String(r.summary || "").slice(0, 200))
  const m: any = r.metadata_json || {}
  console.log("  plan_type:", m.plan_type, "| task_based:", m.task_based)
  console.log("  context:", JSON.stringify(m.context || null).slice(0, 200))
}
