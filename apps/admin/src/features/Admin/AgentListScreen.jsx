import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "../../services/firebase";

export default function AgentListScreen() {
  const navigate = useNavigate();
  const [agents, setAgents] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadAgents() {
      setIsLoading(true);
      setError("");
      try {
        const snap = await getDocs(
          query(collection(db, "agents"), orderBy("createdAt", "desc"))
        );
        setAgents(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
      } catch (err) {
        setError(err.message || "Failed to load agents.");
      } finally {
        setIsLoading(false);
      }
    }
    loadAgents();
  }, []);

  const assignedGroupsLabel = (assignedGroups) => {
    if (!Array.isArray(assignedGroups) || assignedGroups.length === 0) return "None";
    return `${assignedGroups.length} group${assignedGroups.length === 1 ? "" : "s"}`;
  };

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-4xl">
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
            <div>
              <button
                type="button"
                onClick={() => navigate("/admin/dashboard")}
                className="mb-1 flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
              >
                ← Back to Dashboard
              </button>
              <h1 className="text-xl font-semibold text-slate-900">Agents</h1>
            </div>
            <button
              type="button"
              onClick={() => navigate("/admin/agents/new")}
              className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white"
            >
              + Create Agent
            </button>
          </div>

          {isLoading ? (
            <div className="px-6 py-12 text-center">
              <p className="text-sm text-slate-500">Loading agents...</p>
            </div>
          ) : error ? (
            <div className="px-6 py-12 text-center">
              <p className="text-sm text-red-600">{error}</p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="mt-3 text-sm text-slate-600 underline"
              >
                Retry
              </button>
            </div>
          ) : agents.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="text-sm text-slate-500">No agents provisioned yet.</p>
              <button
                type="button"
                onClick={() => navigate("/admin/agents/new")}
                className="mt-3 text-sm text-slate-700 underline"
              >
                Create the first agent
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                    <th className="px-6 py-3">Name</th>
                    <th className="px-6 py-3">Phone</th>
                    <th className="px-6 py-3">Status</th>
                    <th className="px-6 py-3">Assigned Groups</th>
                    <th className="px-6 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {agents.map((agent) => (
                    <tr key={agent.id} className="hover:bg-slate-50">
                      <td className="px-6 py-4 font-medium text-slate-900">
                        {agent.fullName || "—"}
                      </td>
                      <td className="px-6 py-4 text-slate-600">{agent.phone || "—"}</td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                            agent.status === "active"
                              ? "bg-green-100 text-green-700"
                              : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {agent.status || "unknown"}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-slate-600">
                        {assignedGroupsLabel(agent.assignedGroups)}
                      </td>
                      <td className="px-6 py-4">
                        <button
                          type="button"
                          onClick={() =>
                            navigate("/admin/agents/assign", {
                              state: { agentId: agent.uid || agent.id },
                            })
                          }
                          className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          Assign Group
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
