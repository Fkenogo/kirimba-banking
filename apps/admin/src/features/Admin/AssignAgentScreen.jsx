import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { collection, getDocs, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../services/firebase";

export default function AssignAgentScreen() {
  const navigate = useNavigate();
  const location = useLocation();

  const preselectedAgentId = location.state?.agentId || "";

  const [agentId, setAgentId] = useState(preselectedAgentId);
  const [groupId, setGroupId] = useState("");
  const [agents, setAgents] = useState([]);
  const [groups, setGroups] = useState([]);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    async function loadData() {
      setIsLoadingData(true);
      setError("");
      try {
        const [agentsSnap, groupsSnap] = await Promise.all([
          getDocs(query(collection(db, "agents"), where("status", "==", "active"))),
          getDocs(query(collection(db, "groups"), where("status", "==", "active"))),
        ]);
        setAgents(agentsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
        setGroups(groupsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
      } catch (err) {
        setError(err.message || "Failed to load data.");
      } finally {
        setIsLoadingData(false);
      }
    }
    loadData();
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!agentId || !groupId) return;

    setError("");
    setIsSubmitting(true);
    try {
      const assignAgentToGroup = httpsCallable(functions, "assignAgentToGroup");
      await assignAgentToGroup({ agentId, groupId });
      setSuccess(true);
    } catch (err) {
      setError(err.message || "Failed to assign agent.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedAgent = agents.find((a) => (a.uid || a.id) === agentId);
  const selectedGroup = groups.find((g) => g.id === groupId);

  if (success) {
    return (
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-md">
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100 text-green-700 text-lg">
                ✓
              </span>
              <h1 className="text-xl font-semibold text-slate-900">Agent Assigned</h1>
            </div>
            <div className="mt-4 rounded-lg bg-slate-50 p-4">
              <p className="text-sm text-slate-600">
                <span className="font-medium">Agent:</span>{" "}
                {selectedAgent?.fullName || agentId}
              </p>
              <p className="mt-1 text-sm text-slate-600">
                <span className="font-medium">Group:</span>{" "}
                {selectedGroup ? `${selectedGroup.name} (${selectedGroup.groupCode})` : groupId}
              </p>
            </div>
            <p className="mt-3 text-sm text-slate-500">
              The agent can now record deposits for members of this group.
            </p>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => navigate("/admin/agents")}
                className="flex-1 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
              >
                View Agent List
              </button>
              <button
                type="button"
                onClick={() => {
                  setSuccess(false);
                  setGroupId("");
                }}
                className="flex-1 rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700"
              >
                Assign Another
              </button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-md">
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <button
            type="button"
            onClick={() => navigate("/admin/agents")}
            className="mb-4 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
          >
            ← Back to Agent List
          </button>

          <h1 className="text-xl font-semibold text-slate-900">Assign Agent to Group</h1>
          <p className="mt-1 text-sm text-slate-500">
            Allows the agent to record deposits for that group.
          </p>

          {isLoadingData ? (
            <p className="mt-6 text-sm text-slate-500">Loading agents and groups...</p>
          ) : (
            <form onSubmit={handleSubmit} className="mt-5 space-y-4">
              <label className="block text-sm font-medium text-slate-700">
                Agent
                <select
                  required
                  value={agentId}
                  onChange={(e) => setAgentId(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                >
                  <option value="">Select an agent...</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.uid || agent.id}>
                      {agent.fullName} — {agent.phone}
                    </option>
                  ))}
                </select>
                {agents.length === 0 ? (
                  <span className="mt-1 block text-xs text-amber-600">
                    No active agents found. Create an agent first.
                  </span>
                ) : null}
              </label>

              <label className="block text-sm font-medium text-slate-700">
                Group
                <select
                  required
                  value={groupId}
                  onChange={(e) => setGroupId(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                >
                  <option value="">Select a group...</option>
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name} ({group.groupCode})
                    </option>
                  ))}
                </select>
                {groups.length === 0 ? (
                  <span className="mt-1 block text-xs text-amber-600">
                    No active groups found. Approve a group first.
                  </span>
                ) : null}
              </label>

              {error ? <p className="text-sm text-red-600">{error}</p> : null}

              <button
                type="submit"
                disabled={isSubmitting || !agentId || !groupId}
                className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {isSubmitting ? "Assigning..." : "Assign Agent"}
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
