import type { CapacitorConfig } from '@capacitor/cli'

// The phone apps load the same built web app from inside the app bundle.
const config: CapacitorConfig = {
  appId: 'dev.derops.ders',
  appName: 'ضرس',
  webDir: 'dist',
  android: {
    // Serve the bundled app as https://clinic.derops.dev, the origin the API and
    // the edge functions already allow, so nothing on the server has to change.
    // The API lives on clinic-api.derops.dev, so no real request is shadowed.
  },
  server: {
    androidScheme: 'https',
    hostname: 'clinic.derops.dev',
    // iOS cannot use https for a local scheme; it stays capacitor://clinic.derops.dev,
    // which the edge functions allow alongside the web origin.
    iosScheme: 'capacitor',
  },
  ios: { contentInset: 'never' },
}

export default config
