/*
 * Chat group members for display. Pure, no React.
 * A group stores `members` as student ids, in the order the coach selected them.
 * Members are matched against the coach's current students by id (number or string);
 * an id with no matching student (e.g. a deleted student) is shown as "Alumno no disponible".
 */

export const UNAVAILABLE_MEMBER_NAME = "Alumno no disponible";

/*
 * BUG-CHAT-03: group messages cannot be stored (`messages.student_id` is a bigint, a group id is
 * "g…"), so sending to a group is disabled for now. A chat target is a group when it is flagged
 * as one or carries a member list (students never do); such a target must never be used to read,
 * send or mark messages.
 */
export const GROUP_SEND_UNAVAILABLE_TEXT =
  "El envío a grupos todavía no está disponible. Podés escribirle a cada alumno desde su chat individual.";

export function isGroupChat(target) {
  return !!target && typeof target === "object" && (target.isGroup === true || Array.isArray(target.members));
}

const memberIds = (group) => (group && Array.isArray(group.members) ? group.members : []);

/** Number of members in the group, unavailable ones included. */
export function groupMemberCount(group) {
  return memberIds(group).length;
}

/** "1 integrante", "N integrantes". */
export function groupMembersLabel(count) {
  return count === 1 ? "1 integrante" : `${count} integrantes`;
}

/** The members in selection order: { key, id, name, avatar, available }. */
export function groupMemberNames(group, students) {
  const byId = new Map();
  for (const s of Array.isArray(students) ? students : []) {
    if (s && s.id !== null && s.id !== undefined && !byId.has(String(s.id))) byId.set(String(s.id), s);
  }
  return memberIds(group).map((id, index) => {
    const student = id === null || id === undefined ? undefined : byId.get(String(id));
    return student
      ? { key: `${index}:${id}`, id, name: student.name, avatar: student.avatar || "?", available: true }
      : { key: `${index}:${id}`, id, name: UNAVAILABLE_MEMBER_NAME, avatar: "?", available: false };
  });
}
