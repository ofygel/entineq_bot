import 'server-only';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!; // server-only

export const sbAdmin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
