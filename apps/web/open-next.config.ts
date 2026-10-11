import { defineCloudflareConfig } from '@opennextjs/cloudflare';

// No ISR/R2 cache is provisioned: game, wallet and eligibility state is never
// a globally cached authorization decision. Static build assets use ASSETS.
export default defineCloudflareConfig();
