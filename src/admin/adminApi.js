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

export const createCoachInvite = (email) =>
  supabase.rpc("admin_create_coach_invite", { p_email: email });

export const listCoachInvites = ({ search, status, limit, offset } = {}) =>
  supabase.rpc("admin_list_coach_invites", {
    p_search: search ?? null,
    p_status: status ?? null,
    p_limit: limit ?? 25,
    p_offset: offset ?? 0,
  });

export const revokeCoachInvite = (inviteId) =>
  supabase.rpc("admin_revoke_coach_invite", { p_invite_id: inviteId });

export const adminBlockCoach = (coachId, reason) =>
  supabase.rpc("admin_block_coach", { p_coach_id: coachId, p_reason: reason ?? null });

export const adminUnblockCoach = (coachId) =>
  supabase.rpc("admin_unblock_coach", { p_coach_id: coachId });

export const adminDeactivateCoach = (coachId, reason) =>
  supabase.rpc("admin_deactivate_coach", { p_coach_id: coachId, p_reason: reason ?? null });

export const adminReactivateCoach = (coachId) =>
  supabase.rpc("admin_reactivate_coach", { p_coach_id: coachId });

export const adminBlockStudent = (coachId, studentId, reason) =>
  supabase.rpc("admin_block_student", { p_coach_id: coachId, p_student_id: studentId, p_reason: reason ?? null });

export const adminUnblockStudent = (coachId, studentId) =>
  supabase.rpc("admin_unblock_student", { p_coach_id: coachId, p_student_id: studentId });
