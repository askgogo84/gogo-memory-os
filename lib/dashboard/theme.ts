// Dashboard colour theme. Light is the default (Duet brief, 23 Oct); dark is the person's choice, kept in this browser.
export type DashboardTheme = 'dark' | 'light'
export const THEME_STORAGE_KEY = 'askgogo-dashboard-theme'

export function parseTheme(stored: string | null | undefined): DashboardTheme {
  return stored === 'dark' ? 'dark' : 'light'
}

/** Runs before first paint (inline in the dashboard layout) so a dark choice never flashes light. */
export const THEME_BOOT_SCRIPT =
  `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}')==='dark'?'dark':'light';` +
  `var r=document.currentScript&&document.currentScript.parentElement;if(r){r.setAttribute('data-theme',t);` +
  `r.classList.toggle('theme-dark',t==='dark');r.classList.toggle('theme-light',t==='light')}}catch(e){}})()`
