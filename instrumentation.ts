// Runs once per server instance. Installs usage metering for the admin console (docs/admin-console/README.md).
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.ADMIN_METERING_ENABLED !== 'false') {
    const { installFetchMeter } = await import('./lib/metering/fetch-meter')
    installFetchMeter()
  }
}
