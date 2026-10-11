/** Build-time guard: NEXT_PUBLIC values are inlined before any browser code runs. */
export function validatePublicSupabaseKey(value: string | undefined): void {
  if (!value) return;
  const invalid = () => { throw new Error('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be a publishable key or a legacy anon JWT. Secret keys are never permitted in the browser build.'); };
  if (value.length > 4096 || value !== value.trim()) invalid();
  if (/^sb_publishable_[A-Za-z0-9_-]{1,2048}$/.test(value)) return;
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) invalid();
  try {
    const claims: unknown = JSON.parse(Buffer.from(value.split('.')[1]!, 'base64url').toString('utf8'));
    if (!claims || typeof claims !== 'object' || !('role' in claims) || claims.role !== 'anon') invalid();
  } catch { invalid(); }
}
