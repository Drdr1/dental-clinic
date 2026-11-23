import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router'
import '@fontsource/ibm-plex-sans-arabic/arabic-400.css'
import '@fontsource/ibm-plex-sans-arabic/arabic-500.css'
import '@fontsource/ibm-plex-sans-arabic/arabic-600.css'
import '@fontsource/ibm-plex-sans-arabic/arabic-700.css'
import '@fontsource/ibm-plex-sans-arabic/latin-400.css'
import '@fontsource/ibm-plex-sans-arabic/latin-500.css'
import '@fontsource/ibm-plex-sans-arabic/latin-600.css'
import '@fontsource/ibm-plex-sans-arabic/latin-700.css'
import './styles/app.css'
import { I18nProvider } from './i18n'
import { AuthProvider } from './features/auth/AuthProvider'
import { router } from './routes'
import { Capacitor } from '@capacitor/core'
import { App as NativeApp } from '@capacitor/app'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: true } },
})

// Registered only so the app can be installed on a phone's home screen.
// The worker caches nothing (see public/sw.js) — clinic data is always fetched live.
const native = Capacitor.isNativePlatform()

// Phone app: Android's back button goes back a screen, and only leaves the app from the first one.
if (native) {
  NativeApp.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) window.history.back()
    else NativeApp.exitApp()
  })
}

if (!native && 'serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </QueryClientProvider>
    </I18nProvider>
  </StrictMode>,
)
