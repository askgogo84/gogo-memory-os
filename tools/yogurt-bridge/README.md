# AskGogo Meetings — private Yogurt export pilot

This is a **local export tool**, NOT yet AskGogo cloud sync or an enterprise deployment. It reads finished meetings via Yogurt's opt-in local read-only MCP interface and writes JSON files to your own computer. It does not access raw audio, send anything to AskGogo, or make outbound network requests.

## Windows start

1. Download and install Yogurt from its [official Windows release](https://github.com/FrigadeHQ/yogurt/releases/latest/download/Yogurt-windows-x64.exe). Complete model downloads and record one consenting test meeting.
2. In Yogurt, open **Settings → AI apps**, enable access, and copy the local helper command. Keep access disabled except during intentional exports.
3. Install Node.js 20+ for the pilot; a future managed installer would bundle its runtime.
4. In PowerShell, run the following from this directory. Replace the helper executable path. If Yogurt's command supplies arguments, pass each one using `--helper-arg`.

```powershell
node .\bridge.mjs --helper "C:\FULL\PATH\TO\yogurt-mcp.exe" --out "$env:USERPROFILE\AskGogoMeetings\local-export"
```

Add `--include-transcript` only if you want to export transcript text. By default it exports summaries and personal notes. Raw audio is **never** exported. In-progress recordings are skipped.

## Scope and privacy

- Export is **local only**. There is no upload or cloud sync.
- JSON files are **not encrypted by this script**. Protect devices with disk encryption, local policies and correct user permissions. Do not use this pilot for regulated enterprise data.
- Never expose Yogurt's local named pipe/socket or helper on a network. Its MCP is read-only but has no per-app token.
- A future secure AskGogo connector must add authenticated device pairing, per-meeting consent, tenant-isolated ingestion, revocation, deletion, audit logs, signed builds and employee provisioning.

## Tests

Run `npm test` to execute mock MCP tests without connecting to Yogurt or sending data anywhere.
