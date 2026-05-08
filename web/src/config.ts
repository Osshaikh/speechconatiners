export type ProfileId = "local" | "aks";

export interface SpeechLocale {
  code: "en-IN" | "hi-IN";
  label: string;
  sttHost: string;
  ttsHost: string;
  voice: string;
}

export interface EndpointProfile {
  id: ProfileId;
  label: string;
  description: string;
  badgeColor: string;
  locales: SpeechLocale[];
}

export const ENDPOINT_PROFILES: Record<ProfileId, EndpointProfile> = {
  local: {
    id: "local",
    label: "Local (Docker Desktop)",
    description: "Containers on this machine — ports 5001-5004",
    badgeColor: "#1d4ed8",
    locales: [
      { code: "en-IN", label: "English (India)", sttHost: "ws://localhost:5001", ttsHost: "http://localhost:5003", voice: "en-IN-NeerjaNeural" },
      { code: "hi-IN", label: "हिंदी (Hindi)",   sttHost: "ws://localhost:5002", ttsHost: "http://localhost:5004", voice: "hi-IN-SwaraNeural"  },
    ],
  },
  aks: {
    id: "aks",
    label: "AKS (Central India)",
    description: "iitbombay-aks · LoadBalancer public IPs · port 80",
    badgeColor: "#15803d",
    locales: [
      { code: "en-IN", label: "English (India)", sttHost: "ws://4.224.118.93",   ttsHost: "http://20.244.72.178", voice: "en-IN-NeerjaNeural" },
      { code: "hi-IN", label: "हिंदी (Hindi)",   sttHost: "ws://20.204.222.184", ttsHost: "http://4.224.108.62",  voice: "hi-IN-SwaraNeural"  },
    ],
  },
};

export const DEFAULT_PROFILE: ProfileId = "local";

// Legacy named exports kept for any code that still imports them; default to local profile.
export const LOCALES = ENDPOINT_PROFILES.local.locales;
export type Locale = SpeechLocale;
