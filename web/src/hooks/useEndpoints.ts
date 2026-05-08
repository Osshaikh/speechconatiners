import { useCallback, useEffect, useMemo, useState } from "react";
import { DEFAULT_PROFILE, ENDPOINT_PROFILES, type ProfileId, type SpeechLocale } from "../config";

const STORAGE_KEY = "speechEndpointProfile";

function loadProfile(): ProfileId {
  if (typeof window === "undefined") return DEFAULT_PROFILE;
  const v = window.localStorage.getItem(STORAGE_KEY) as ProfileId | null;
  return v && ENDPOINT_PROFILES[v] ? v : DEFAULT_PROFILE;
}

export function useEndpoints() {
  const [profileId, setProfileId] = useState<ProfileId>(loadProfile);

  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, profileId); } catch { /* ignore */ }
  }, [profileId]);

  const profile = ENDPOINT_PROFILES[profileId];
  const locales: SpeechLocale[] = useMemo(() => profile.locales, [profile]);

  const setProfile = useCallback((id: ProfileId) => setProfileId(id), []);

  return { profile, profileId, setProfile, locales };
}
