import { doc, getDoc } from "firebase/firestore";

export async function resolveCurrentGroupId(db, userId) {
  const gmSnap = await getDoc(doc(db, "groupMembers", userId));
  if (gmSnap.exists()) {
    const groupId = String(gmSnap.data()?.groupId || "").trim();
    if (groupId) {
      return groupId;
    }
  }

  const userSnap = await getDoc(doc(db, "users", userId));
  if (!userSnap.exists()) {
    return null;
  }

  const userData = userSnap.data() || {};
  return String(userData.groupId || userData.ledGroupId || "").trim() || null;
}

export async function loadCurrentGroup(db, userId) {
  const groupId = await resolveCurrentGroupId(db, userId);
  if (!groupId) {
    return { groupId: null, group: null };
  }

  const groupSnap = await getDoc(doc(db, "groups", groupId));
  if (!groupSnap.exists()) {
    return { groupId, group: null };
  }

  return {
    groupId,
    group: { id: groupSnap.id, ...groupSnap.data() },
  };
}

export async function confirmLeaderClaim(user) {
  const token = await user.getIdTokenResult(true);
  return token?.claims?.role === "leader";
}
