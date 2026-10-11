import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePublicSupabaseKey } from '../lib/public-config';
const jwt = (role: string) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.dGVzdC1vbmx5`;
test('browser build permits only publishable and legacy anon Supabase keys', () => {
  for (const key of [undefined, '', 'sb_publishable_test_fixture', jwt('anon')]) assert.doesNotThrow(() => validatePublicSupabaseKey(key));
  for (const key of ['sb_secret_test_fixture', jwt('service_role'), jwt('authenticated'), 'arbitrary', 'sb_publishable_', 'sb_publishable_bad value', ' sb_publishable_test']) {
    assert.throws(() => validatePublicSupabaseKey(key), error => error instanceof Error && !error.message.includes(key));
  }
});
