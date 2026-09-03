import { supabase } from "../services/supabaseClient.js";

export const getAdminSession = () => supabase.rpc("admin_get_session");

export const listCoaches = ({ search, onboarded, limit, offset } = {}) =>
  supabase.rpc("admin_list_coaches", {
    p_search: search ?? null,
    p_onboarded: onboarded ?? null,
    p_limit: limit ?? 25,
    p_offset: offset ?? 0,
  });

export const getCoach = (coachId) =>
  supabase.rpc("admin_get_coach", { p_coach_id: coachId });

export const listStudents = ({ search, coachId, portal, status, limit, offset } = {}) =>
  supabase.rpc("admin_list_students", {
    p_search: search ?? null,
    p_coach_id: coachId ?? null,
    p_portal: portal ?? null,
    p_status: status ?? null,
    p_limit: limit ?? 25,
    p_offset: offset ?? 0,
  });

export const getStudent = (coachId, studentId) =>
  supabase.rpc("admin_get_student", { p_coach_id: coachId, p_student_id: studentId });
