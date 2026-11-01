import { useEffect, useRef, useState } from 'react';
import { Loader2, MapPin, ShieldCheck } from 'lucide-react';
import { mountTrustedMap } from '../trustedMapProviders.js';

export default function TrustedMapCanvas({ provider, settings, center, features, onSelect }) {
  const containerRef = useRef(null);
  const [state, setState] = useState({ tone: 'loading', message: 'Loading the provider-native map…' });
  const featureKey = (features || []).map(feature => feature.id).join('|');

  useEffect(() => {
    let cancelled = false;
    let unmountMap = null;
    setState({ tone: 'loading', message: 'Loading the provider-native map…' });
    mountTrustedMap({ container: containerRef.current, provider, settings, center, features, onSelect })
      .then(cleanup => {
        if (cancelled) cleanup?.();
        else {
          unmountMap = cleanup;
          setState({ tone: 'ready', message: provider === 'apple' ? 'Apple Maps · interactive map and place annotations' : 'Google Maps · interactive map and place markers' });
        }
      })
      .catch(error => {
        if (!cancelled) setState({ tone: 'error', message: error instanceof Error ? error.message : 'The provider map could not be displayed.' });
      });
    return () => {
      cancelled = true;
      unmountMap?.();
    };
  }, [provider, settings.googleApiKey, settings.appleMapKitToken, center.lat, center.lon, featureKey, onSelect]);

  return (
    <section className="trusted-native-map-card" aria-label={`${provider === 'apple' ? 'Apple Maps' : 'Google Maps'} search results map`}>
      <div className="trusted-native-map-heading">
        <div><span className="section-eyebrow">PROVIDER-NATIVE MAP VIEW</span><strong>{provider === 'apple' ? 'Apple Maps' : 'Google Maps'}</strong></div>
        <span className={`trusted-native-map-status ${state.tone}`}>{state.tone === 'loading' ? <Loader2 size={12} className="spin-icon" /> : <ShieldCheck size={12} />}{state.tone === 'ready' ? 'MAP READY' : state.tone === 'loading' ? 'LOADING' : 'MAP ISSUE'}</span>
      </div>
      <div className="trusted-native-map-canvas" ref={containerRef} />
      <div className={`trusted-native-map-caption ${state.tone}`} role="status" aria-live="polite">
        {state.tone === 'error' ? <MapPin size={12} /> : <ShieldCheck size={12} />}
        <span>{state.message}</span>
      </div>
      <p className="trusted-native-map-policy">Live provider place data is shown on its own provider map with its native attribution. It is not copied into JalRakshak's custom 3D scene or stored in the offline map library. Use licensed/imported GeoJSON layers for the custom digital-twin geometry.</p>
    </section>
  );
}
