import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { AlertCircle, ArrowLeft, ChevronRight, ExternalLink, Loader2, Lock, Search, ShieldCheck } from 'lucide-react';
import { organizerApi, OrganizerApiError } from '@/services/organizerApi';

function Badge({children,tone='muted'}:any){ const m:any={ lime:'bg-[#d8e35b] text-[#171a2d]', blue:'bg-[#5aafbd] text-white', coral:'bg-[#f26a4f] text-white', dark:'bg-[#171a2d] text-white', muted:'bg-[#e9e5da] text-[#77798a]' }; return <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-bold uppercase ${m[tone]||m.muted}`}>{children}</span>}

export default function OrganizerAudit(){
  const [logs,setLogs]=useState<any[]>([]);
  const [filtered,setFiltered]=useState<any[]>([]);
  const [q,setQ]=useState('');
  const [filterAction,setFilterAction]=useState('All');
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);
  const [selectedLog,setSelectedLog]=useState<any|null>(null);

  const load=async()=>{
    setLoading(true); setError(null);
    try{
      const list = await organizerApi.listAuditLogs({limit:100});
      setLogs(list);
      setFiltered(list);
    }catch(e:any){
      if(e instanceof OrganizerApiError && e.status===403) setError('Only organizers can view the activity log.');
      else setError(e.message)
    } finally{ setLoading(false)}
  }
  useEffect(()=>{ load() },[]);

  useEffect(()=>{
    let lst = logs;
    if(filterAction!=='All') lst = lst.filter(l=> l.action===filterAction);
    if(q) lst = lst.filter(l=> `${l.action} ${l.resourceType} ${l.actorId||''}`.toLowerCase().includes(q.toLowerCase()));
    setFiltered(lst);
  },[logs,q,filterAction]);

  const actions = Array.from(new Set(logs.map(l=>l.action))).slice(0,12);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/organizer/dashboard" aria-label="Back" title="Back" className="rounded-xl border border-[#dedbd1] bg-[#fdfbf5] p-2"><ArrowLeft size={16}/></Link>
        <div>
                    <h1 className="text-2xl font-bold">Activity log</h1>
          <p className="text-xs text-[#77798a]">A record of every important change.</p>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="relative flex-1"><Search size={14} className="absolute left-3 top-3 text-[#aaa9a2]"/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search action, resource, actor" className="hmt-input pl-9"/></label>
        <select value={filterAction} onChange={e=>setFilterAction(e.target.value)} className="hmt-input sm:w-56"><option>All</option>{actions.map(a=> <option key={a} value={a}>{a}</option>)}</select>
        <button onClick={load} className="rounded-xl border border-[#dedbd1] bg-[#fdfbf5] px-4 py-2 text-xs font-bold">Refresh</button>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex gap-2"><AlertCircle size={16}/>{error}</div>}
      {loading && <div className="flex items-center gap-2 text-sm text-[#77798a]"><Loader2 size={16} className="animate-spin"/> Loading activity…</div>}

      {!loading && !error && filtered.length===0 ? (
        <div className="rounded-2xl border border-dashed border-[#dedbd1] bg-[#fdfbf5] p-8 text-center text-sm text-[#77798a]">No activity yet.</div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.7fr_.8fr]">
        <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[#e5e1d7] text-left font-mono text-[11px] uppercase tracking-wider text-[#77798a]"><th className="px-3 py-3">Timestamp</th><th className="px-3 py-3">Action</th><th className="px-3 py-3">Resource</th><th className="px-3 py-3">Actor</th><th className="px-3 py-3">Outcome</th></tr></thead>
              <tbody>
                {filtered.map((l:any)=>(
                  <tr key={l.id} onClick={async()=>{ try{ const full=await organizerApi.getAuditLog(l.id); setSelectedLog(full)}catch{ setSelectedLog(l)}}} className={`border-b border-[#e5e1d7]/60 last:border-0 cursor-pointer hover:bg-[#f4f1e8] ${selectedLog?.id===l.id?'bg-[#fff6f3]':''}`}>
                    <td className="px-3 py-2.5 font-mono text-xs">{new Date(l.timestamp).toLocaleString()}</td>
                    <td className="px-3 py-2.5"><span className="rounded-full bg-[#f4f1e8] px-2 py-1 text-[11px] font-bold">{l.action}</span></td>
                    <td className="px-3 py-2.5 text-xs">{l.resourceType} <span className="font-mono text-[11px] text-[#77798a]">{l.resourceId?.slice(0,6)||'—'}</span></td>
                    <td className="px-3 py-2.5 font-mono text-xs">{l.actorId?.slice(0,8)||'—'} <span className="text-[#77798a]">{l.actorRole||''}</span></td>
                    <td className="px-3 py-2.5"><Badge tone={l.outcome==='success'?'lime':'coral'}>{l.outcome}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-[#e5e1d7] bg-[#f4f1e8] px-4 py-3 flex items-center gap-2 text-xs text-[#77798a]"><ShieldCheck size={14} className="text-[#5aafbd]"/>{filtered.length} entries</div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-5">
            <h3 className="font-bold">Detail</h3>
            {selectedLog ? (
              <div className="mt-3 space-y-2 text-xs">
                <div className="rounded-xl bg-[#f4f1e8] p-3"><div className="font-bold">{selectedLog.action}</div><div className="text-[#77798a]">{selectedLog.resourceType} · {selectedLog.resourceId}</div><div className="mt-1 font-mono text-[11px]">id {selectedLog.id}</div><div className="font-mono text-[11px]">{new Date(selectedLog.timestamp).toLocaleString()}</div></div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-xl border border-[#e5e1d7] bg-white p-2"><div className="text-[#77798a]">Actor</div><div className="font-mono font-bold">{selectedLog.actorId?.slice(0,12)} · {selectedLog.actorRole}</div></div>
                  <div className="rounded-xl border border-[#e5e1d7] bg-white p-2"><div className="text-[#77798a]">Outcome</div><div className="font-bold">{selectedLog.outcome}</div></div>
                  <div className="rounded-xl border border-[#e5e1d7] bg-white p-2"><div className="text-[#77798a]">IP</div><div className="font-mono">{selectedLog.ip || '—'}</div></div>
                  <div className="rounded-xl border border-[#e5e1d7] bg-white p-2"><div className="text-[#77798a]">RequestId</div><div className="font-mono text-[11px]">{selectedLog.requestId?.slice(0,12) || '—'}</div></div>
                </div>
                {selectedLog.metadata && <div className="rounded-xl bg-[#171a2d] p-3 text-[#fdfbf5]"><div className="font-mono text-[10px] uppercase tracking-wider text-[#d8e35b]">Metadata</div><pre className="mt-2 text-[11px] whitespace-pre-wrap break-words">{JSON.stringify(selectedLog.metadata, null, 2)}</pre></div>}

              </div>
            ) : <div className="mt-3 rounded-xl bg-[#f4f1e8] p-4 text-xs text-[#77798a]">Select an entry to see details.</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
