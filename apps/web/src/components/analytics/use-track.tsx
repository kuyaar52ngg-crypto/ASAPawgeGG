"use client";
import { useEffect, useRef } from "react";
import { trackClient, type ClientEventName } from "./track-client";

/** `const track = useTrack(); track("add_to_cart", { productId, quantity, value })` — stable reference, safe in handlers. */
export function useTrack(): typeof trackClient {
  return trackClient;
}

/** Fire an event once when the component mounts (e.g. `begin_checkout` on the checkout page). */
export function TrackEvent({ name, properties }: { name: ClientEventName; properties?: Record<string, unknown> }) {
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    trackClient(name, properties);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
