import { ENDPOINT_PROFILES, type ProfileId } from "../config";
import { useEndpoints } from "../hooks/useEndpoints";

export default function EndpointToggle() {
  const { profileId, setProfile, profile } = useEndpoints();
  return (
    <div className="endpoint-toggle">
      <label htmlFor="ep-select" className="endpoint-toggle__label">Speech endpoint</label>
      <select
        id="ep-select"
        value={profileId}
        onChange={(e) => setProfile(e.target.value as ProfileId)}
      >
        {Object.values(ENDPOINT_PROFILES).map((p) => (
          <option key={p.id} value={p.id}>{p.label}</option>
        ))}
      </select>
      <span
        className="endpoint-toggle__pill"
        style={{ background: profile.badgeColor }}
        title={profile.description}
      >
        {profile.id.toUpperCase()}
      </span>
    </div>
  );
}
