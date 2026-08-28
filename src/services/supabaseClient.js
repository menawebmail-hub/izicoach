import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  'https://eerocqdoawrciatvqnof.supabase.co',
  'sb_publishable_DHrf_q9EoNFkYnhIaameuw_LVfnGXvG'
);
window.supabase = supabase;
