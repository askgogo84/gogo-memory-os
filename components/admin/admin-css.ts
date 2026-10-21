// Admin console styles: light, hairlines, one muted green accent, mobile-first (tested at 375px).
export const ADMIN_CSS = `
.adm{--bg:#fff;--surface:#F7F7F6;--rail:#FBFBFA;--ink:#1C1C1E;--ink2:#5E5E63;--ink3:#6E6E73;--line:#ECECEE;--line2:#DCDCDF;--accent:#56694F;--okbg:#EEF1EC;--okfg:#3F5139;--badbg:#FBEDEA;--badfg:#8A3424;--warnbg:#FDF3E3;--warnfg:#7A4E10;--nbg:#F2F2F1;--nfg:#56565A;
  font-family:"Instrument Sans",-apple-system,"Segoe UI",system-ui,sans-serif;color:var(--ink);background:var(--bg);min-height:100vh;display:flex;flex-wrap:wrap;align-items:stretch;color-scheme:light}
.adm *{box-sizing:border-box}
.adm a{color:var(--ink)} .adm a:hover{color:var(--accent)}
.adm button,.adm input,.adm select,.adm textarea{font-family:inherit;font-size:14px;color:var(--ink)}
.adm :focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.adm-rail{flex:1 1 220px;padding:20px 16px;border-right:1px solid var(--line);background:var(--rail)}
.adm-brand{font-size:20px;font-weight:600;letter-spacing:-.02em;padding:4px 10px 16px}
.adm-brand span{color:var(--accent)} .adm-brand small{font-weight:400;color:var(--ink2);font-size:15px;letter-spacing:0}
.adm-nav{display:flex;flex-wrap:wrap;gap:2px}
.adm-nav a{flex:1 1 170px;display:flex;align-items:center;justify-content:space-between;min-height:44px;padding:0 12px;border-radius:10px;font-size:14px;font-weight:500;color:var(--ink2);text-decoration:none}
.adm-nav a[aria-current=page]{background:#ECECEA;color:var(--ink)}
.adm-nav .badge{font-size:12px;background:var(--ink);color:#fff;border-radius:999px;padding:2px 8px}
.adm-who{margin:20px 10px 0;padding-top:16px;border-top:1px solid var(--line);font-size:13px;color:var(--ink3);line-height:1.6}
.adm-main{flex:999 1 560px;min-width:0;padding:28px 20px 80px}
@media(min-width:900px){.adm-main{padding:28px 32px 80px}}
.adm-stack{display:flex;flex-direction:column;gap:32px}
.adm-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:12px}
.adm h1{margin:0;font-size:30px;font-weight:500;letter-spacing:-.025em}
@media(min-width:900px){.adm h1{font-size:34px}}
.adm h2{margin:0 0 12px;font-size:20px;font-weight:500}
.adm h3{margin:0 0 8px;font-size:16px;font-weight:500}
.adm .lede{margin:6px 0 0;color:var(--ink2);font-size:15px;max-width:66ch;line-height:1.5}
.adm .note{margin:8px 0 0;font-size:13px;color:var(--ink3);line-height:1.5}
.adm-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));border-top:1px solid var(--line2);border-bottom:1px solid var(--line)}
.adm-kpi{padding:16px;border-right:1px solid var(--line);border-bottom:1px solid var(--line)}
.adm-kpi .l{font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink3)}
.adm-kpi .v{font-size:26px;font-weight:500;letter-spacing:-.02em;margin-top:6px}
.adm-kpi .s{font-size:13px;color:var(--ink2);margin-top:2px}
.adm-cols{display:flex;flex-wrap:wrap;gap:40px}
.adm-cols>section,.adm-cols>div{flex:1 1 360px;min-width:0}
.adm-list{border-top:1px solid var(--line2)}
.adm-row{display:flex;align-items:center;gap:12px;padding:11px 0;border-bottom:1px solid var(--line);font-size:14px;min-width:0}
.adm-row .grow{flex:1 1 auto;min-width:0}
.adm-row .muted{color:var(--ink3);font-size:13px}
.adm-bar{flex:1 1 auto;height:8px;background:var(--line);border-radius:999px;overflow:hidden;min-width:40px}
.adm-bar>i{display:block;height:100%;background:var(--accent)}
.adm-bar.ink>i{background:var(--ink)}
.adm-bar.warn>i{background:#B5563F}
.adm-table{overflow-x:auto;border-top:1px solid var(--line2)}
.adm-table table{border-collapse:collapse;width:100%}
.adm-table th{font-size:12px;font-weight:500;letter-spacing:.08em;text-transform:uppercase;color:var(--ink3);text-align:left;padding:10px 12px;border-bottom:1px solid var(--line2);white-space:nowrap}
.adm-table td{font-size:14px;padding:11px 12px;border-bottom:1px solid var(--line);white-space:nowrap;vertical-align:middle}
.adm-table td.wrap{white-space:normal;min-width:200px}
.adm-table tr:hover td{background:#FAFAF9}
.adm .pill{display:inline-block;font-size:12px;font-weight:500;padding:3px 10px;border-radius:999px;white-space:nowrap;background:var(--nbg);color:var(--nfg)}
.adm .pill.ok{background:var(--okbg);color:var(--okfg)} .adm .pill.bad{background:var(--badbg);color:var(--badfg)} .adm .pill.warn{background:var(--warnbg);color:var(--warnfg)}
.adm .btn{display:inline-flex;align-items:center;justify-content:center;min-height:40px;padding:0 14px;border-radius:999px;border:1px solid var(--line2);background:#fff;font-size:13px;font-weight:500;cursor:pointer;text-decoration:none;white-space:nowrap;color:var(--ink)}
.adm .btn.lg{min-height:44px;padding:0 18px;font-size:14px}
.adm .btn.solid{background:var(--ink);border-color:var(--ink);color:#fff}
.adm .btn.danger{color:var(--badfg);border-color:var(--badfg)}
.adm .btn.sm{min-height:36px;padding:0 12px}
.adm .btn:disabled{opacity:.5;cursor:default}
.adm .chips{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.adm .chip{min-height:40px;padding:0 14px;border-radius:999px;font-size:13px;font-weight:500;border:1px solid var(--line2);background:#fff;cursor:pointer;color:var(--ink);text-decoration:none;display:inline-flex;align-items:center;gap:6px}
.adm .chip[aria-pressed=true],.adm .chip[aria-current=true]{background:var(--ink);border-color:var(--ink);color:#fff}
.adm .field{min-height:44px;padding:0 12px;border:1px solid var(--line2);border-radius:10px;background:var(--surface);max-width:100%}
.adm textarea.field{padding:12px;min-height:100px;width:100%;line-height:1.5}
.adm label.lbl{font-size:13px;font-weight:500;display:block;margin-bottom:6px}
.adm .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.adm .banner{padding:12px 14px;border:1px solid var(--line2);border-radius:10px;background:var(--surface);font-size:14px;line-height:1.5}
.adm .banner.bad{background:var(--badbg);border-color:#F0D3CC;color:var(--badfg)}
.adm .vbars{display:flex;align-items:flex-end;gap:4px;height:150px;border-bottom:1px solid var(--line2)}
.adm .vbars>div{flex:1 1 0;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;gap:4px;min-width:0}
.adm .vbars i{display:block;width:100%;max-width:28px;border-radius:3px 3px 0 0;background:var(--ink)}
.adm .vbars i.now{background:var(--accent)}
.adm .vbars span{font-size:11px;color:var(--ink3)}
.adm .axis{display:flex;justify-content:space-between;font-size:12px;color:var(--ink3);margin-top:6px}
.adm .form-row{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end}
.adm .form-row>div{flex:1 1 180px}
.adm .card{border:1px solid var(--line2);border-radius:16px;padding:16px;background:var(--surface)}
`
