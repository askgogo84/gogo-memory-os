// Dashboard colour theme. Dark is the default; light is the person's choice, kept in this browser.
export type DashboardTheme = 'dark' | 'light'
export const THEME_STORAGE_KEY = 'askgogo-dashboard-theme'

export function parseTheme(stored: string | null | undefined): DashboardTheme {
  return stored === 'light' ? 'light' : 'dark'
}

/** Runs before first paint (inline in the dashboard layout) so a light choice never flashes dark. */
export const THEME_BOOT_SCRIPT =
  `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}')==='light'?'light':'dark';` +
  `var r=document.currentScript&&document.currentScript.parentElement;if(r){r.setAttribute('data-theme',t);` +
  `r.classList.toggle('theme-dark',t==='dark');r.classList.toggle('theme-light',t==='light')}}catch(e){}})()`
