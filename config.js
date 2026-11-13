// SVAVARS VR APP PoC — shared settings.
// The publishable key is safe in the browser: Row Level Security protects the data.
export const SUPABASE_URL = 'https://tufzwiursejmsvkjpgns.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_ThoO3GTBa0ygoUVZzJs70A_EWy0fJOG';

// One test video for the PoC (equirectangular 360° MP4, served from R2 with CORS).
// Replace with the real R2 address once the clip is uploaded.
export const VIDEO_URL = 'https://REPLACE-WITH-R2-ADDRESS/videos/test/play.mp4';

// Commands older than this are treated as stale and ignored by the headset.
export const STALE_AFTER_MS = 30_000;
