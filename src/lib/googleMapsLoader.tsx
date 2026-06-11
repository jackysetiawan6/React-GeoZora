declare global {
  interface Window {
    google?: any;
    __googleMapsReady?: () => void;
  }
}

let googleMapsLoaderPromise: Promise<void> | null = null;

export function loadGoogleMaps(apiKey: string): Promise<void> {
  if (window.google?.maps?.StreetViewPanorama) return Promise.resolve();

  if (!googleMapsLoaderPromise) {
    googleMapsLoaderPromise = new Promise((resolve, reject) => {
      const callbackName = '__googleMapsReady';

      window[callbackName] = () => {
        if (window.google?.maps?.StreetViewPanorama) {
          resolve();
        } else {
          reject(new Error('Google Maps Street View API is unavailable.'));
        }
      };

      const existingScript = document.querySelector<HTMLScriptElement>(
        'script[data-google-maps-loader="true"]'
      );

      if (existingScript) {
        if (window.google?.maps?.StreetViewPanorama) {
          resolve();
          return;
        }

        existingScript.addEventListener(
          'load',
          () => {
            if (window.google?.maps?.StreetViewPanorama) resolve();
          },
          { once: true }
        );

        existingScript.addEventListener(
          'error',
          () => reject(new Error('Google Maps JS API failed to load.')),
          { once: true }
        );

        return;
      }

      const script = document.createElement('script');
      script.dataset.googleMapsLoader = 'true';
      script.async = true;
      script.defer = true;
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
        apiKey
      )}&v=weekly&loading=async&libraries=marker&callback=${callbackName}`;
      script.onerror = () => reject(new Error('Google Maps JS API failed to load.'));
      document.head.appendChild(script);
    });

    googleMapsLoaderPromise.catch(() => {
      googleMapsLoaderPromise = null;
    });
  }

  return googleMapsLoaderPromise;
}