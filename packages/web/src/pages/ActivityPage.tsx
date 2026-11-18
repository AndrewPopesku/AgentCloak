import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { ActivityDetail, ActivityEntry, Connection } from "../api/types";
import { Card } from "../components/Card";

const statusClass = { passed: "bg-emerald-900 text-emerald-300", redacted: "bg-amber-900 text-amber-300", blocked: "bg-red-900 text-red-300" };

export function ActivityPage() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selected, setSelected] = useState<ActivityDetail | null>(null);
  const [connection, setConnection] = useState("");
  const [tool, setTool] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => { api.listConnections().then(setConnections).catch((e: Error) => setError(e.message)); }, []);
  useEffect(() => {
    const params = new URLSearchParams({ limit: "50", offset: String(page * 50) });
    if (connection) params.set("connection", connection);
    if (tool) params.set("tool", tool);
    if (status) params.set("status", status);
    api.listActivity(params).then((result) => { setEntries(result.entries); setTotal(result.total); }).catch((e: Error) => setError(e.message));
  }, [connection, tool, status, page]);
  const label = (id: string) => connections.find((item) => item.id === id)?.displayName ?? connections.find((item) => item.id === id)?.email ?? id;
  return <div className="mx-auto max-w-6xl space-y-6">
    <h1 className="text-2xl font-bold">Activity</h1>
    {error && <p className="text-red-400">{error}</p>}
    <div className="flex flex-wrap gap-3 text-sm">
      <select aria-label="Connection" value={connection} onChange={(e) => { setConnection(e.target.value); setPage(0); }} className="rounded bg-zinc-800 p-2"><option value="">All connections</option>{connections.map((item) => <option key={item.id} value={item.id}>{item.displayName ?? item.email}</option>)}</select>
      <input aria-label="Tool" placeholder="Tool name" value={tool} onChange={(e) => { setTool(e.target.value); setPage(0); }} className="rounded bg-zinc-800 p-2" />
      <select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }} className="rounded bg-zinc-800 p-2"><option value="">All statuses</option><option value="ok">OK</option><option value="error">Error</option><option value="blocked">Blocked</option></select>
    </div>
    <Card><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-zinc-400"><tr>{["Time", "Connection", "Agent key", "Tool", "Status", "Duration", "Returned / Redacted / Blocked", "Gmail calls"].map((name) => <th key={name} className="p-2">{name}</th>)}</tr></thead><tbody>{entries.map((entry) => <tr key={entry.id} onClick={() => api.getActivity(entry.id).then(setSelected).catch((e: Error) => setError(e.message))} className="cursor-pointer border-t border-zinc-800 hover:bg-zinc-800/50"><td className="p-2 whitespace-nowrap">{new Date(entry.createdAt).toLocaleString()}</td><td className="p-2">{label(entry.connectionId)}</td><td className="p-2">{entry.apiKeyName ?? entry.apiKeyPrefix ?? "—"}</td><td className="p-2">{entry.toolName}</td><td className="p-2">{entry.status}</td><td className="p-2">{entry.durationMs} ms</td><td className="p-2">{entry.returnedCount} / {entry.redactedCount} / {entry.blockedCount}</td><td className="p-2">{entry.providerCalls}</td></tr>)}</tbody></table>{entries.length === 0 && <p className="p-4 text-zinc-400">No activity recorded.</p>}</div></Card>
    <div className="flex items-center gap-3 text-sm"><button disabled={page === 0} onClick={() => setPage(page - 1)} className="disabled:text-zinc-600">Previous</button><span>{page * 50 + 1}–{Math.min((page + 1) * 50, total)} of {total}</span><button disabled={(page + 1) * 50 >= total} onClick={() => setPage(page + 1)} className="disabled:text-zinc-600">Next</button></div>
    {selected && <div role="dialog" aria-label="Activity detail" className="fixed inset-0 z-50 overflow-auto bg-black/80 p-4" onClick={() => setSelected(null)}><div className="mx-auto max-w-3xl space-y-4 rounded-lg bg-zinc-900 p-6" onClick={(e) => e.stopPropagation()}><div className="flex justify-between"><h2 className="text-xl font-bold">{selected.toolName}</h2><button onClick={() => setSelected(null)}>Close</button></div><p className="text-sm text-zinc-400">{new Date(selected.createdAt).toLocaleString()} · {label(selected.connectionId)} · {selected.status} · {selected.providerCalls} provider calls</p><h3 className="font-semibold">Arguments</h3><pre className="overflow-auto rounded bg-zinc-950 p-3 text-xs whitespace-pre-wrap break-all">{JSON.stringify(selected.arguments, null, 2)}</pre><h3 className="font-semibold">Filter decisions</h3>{selected.filterTrace.length === 0 && <p className="text-zinc-400">No messages filtered.</p>}{selected.filterTrace.map((trace, index) => <div key={`${trace.messageId}-${index}`} className="rounded border border-zinc-700 p-3 text-sm"><span className="font-mono">{trace.messageId}</span> <span className={`rounded px-2 py-1 ${statusClass[trace.decision]}`}>{trace.decision}</span>{trace.sender && <p>Sender: {trace.sender}</p>}{trace.blockReason && <p>Reason: {trace.blockReason}</p>}{trace.decision !== "blocked" && <><p>HTML converted: {trace.sanitizer.htmlConverted ? "yes" : "no"}; invisible characters stripped: {trace.sanitizer.invisibleCharactersStripped}; attachments stripped: {trace.attachmentsStripped}</p>{Object.entries(trace.piiPatterns).map(([name, count]) => <span key={name} className="mr-2 rounded bg-zinc-800 px-2 py-1">{name}: {count}</span>)}{trace.injectionLabels.map((name) => <span key={name} className="mr-2 rounded bg-amber-900 px-2 py-1">{name}</span>)}</>}</div>)}<h3 className="font-semibold">Agent response</h3>{selected.responseTruncated && <p className="text-amber-400">Response was truncated at 256 KiB.</p>}<pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded bg-zinc-950 p-3 font-mono text-xs">{selected.responseText}</pre>{selected.errorMessage && <p className="text-red-400">{selected.errorMessage}</p>}</div></div>}
  </div>;
}
