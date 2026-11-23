import type { CapacitorConfig } from '@capacitor/cli'

// The phone apps load the same built web app from inside the app bundle.
const config: CapacitorConfig = {
  appId: 'dev.derops.ders',
  appName: 'Dentano',
  webDir: 'dist',
  android: {
    // Serve the bundled app as https://my.dentano.app, the origin the API and
    // the edge functions allow. The API lives on api.dentano.app, so no real
    // request is shadowed.
  },
  server: {
    androidScheme: 'https',
    hostname: 'my.dentano.app',
    // iOS cannot use https for a local scheme; it stays capacitor://my.dentano.app,
    // which the edge functions allow alongside the web origin.
    iosScheme: 'capacitor',
  },
  ios: { contentInset: 'never' },
}

export default config
