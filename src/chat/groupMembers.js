/*
 * Chat group members for display. Pure, no React.
 * A group stores `members` as student ids, in the order the coach selected them.
 * Members are matched against the coach's current students by id (number or string);
 * an id with no matching student (e.g. a deleted student) is shown as "Alumno no disponible".
 */

export const UNAVAILABLE_MEMBER_NAME = "Alumno no disponible";

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
