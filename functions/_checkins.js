/** Check-in keys in KV (binding TRIP_KV). One small list per agenda item, plus a version. */
export const placeKey = (id) => `checkin:place:${id}`;
export const CHECKIN_VERSION_KEY = "checkin:version";
