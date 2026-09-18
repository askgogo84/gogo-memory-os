import { Sandbox } from "@vercel/sandbox"

const sandbox = await Sandbox.create({
  token: process.env.VERCEL_TOKEN,
  teamId: process.env.VERCEL_TEAM_ID,
  projectId: process.env.VERCEL_PROJECT_ID,
  image: "vercel/sandbox/node:24",
  region: process.env.GOGO_SANDBOX_REGION || "bom1",
  timeout: 5 * 60 * 1000,
  resources: { vcpus: 1 },
} as any)

const probe = await sandbox.runCommand({
  cmd: "bash",
  args: ["-lc", "echo HOME=$HOME; echo PWD=$(pwd); echo WHOAMI=$(whoami); echo ---; ls -la /home 2>/dev/null; echo ---; ls -la /vercel 2>/dev/null; echo ---; echo EXISTS=$([ -d /home/vercel-sandbox ] && echo yes || echo no)"],
})
console.log("exit:", probe.exitCode)
console.log(await probe.stdout())
console.log("stderr:", await probe.stderr())
await sandbox.stop()
