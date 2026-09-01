import { supabase } from "../services/supabaseClient.js";

export const getAdminSession = () => supabase.rpc("admin_get_session");
