import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { AlertCircle, ArrowLeft, Search, Users, ShieldCheck, Loader2 } from 'lucide-react';
import { organizerApi, OrganizerApiError } from '@/services/organizerApi';

function Badge({children,tone='muted'}:any){ const m:any={ lime:'bg-[#d8e35b] text-[#171a2d]', blue:'bg-[#5aafbd] text-white', coral:'bg-[#f26a4f] text-white', muted:'bg-[#e9e5da] text-[#77798a]' }; return <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${m[tone]||m.muted}`}>{children}</span>}

export default function OrganizerParticipants(){
  const [hackathons,setHackathons]=useState<any[]>([]);
  const [selected,setSelected]=useState<string>('');
  const [participants,setParticipants]=useState<any[]>([]);
  const [q,setQ]=useState('');
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [initialLoading,setInitialLoading]=useState(true);

  useEffect(()=>{
    async function init(){
      try{
        const list = await organizerApi.listHackathons();
        setHackathons(list);
        if(list[0]) setSelected(list[0].id);
      }catch(e:any){ setError(e.message)} finally{ setInitialLoading(false)}
    }
    init();
  },[]);

  useEffect(()=>{
    if(!selected) return;
    setLoading(true); setError(null);
    organizerApi.listParticipants(selected).then(setParticipants).catch((e:any)=>{
      if(e instanceof OrganizerApiError && e.status===403) setError('Not owner — only owning organizer or ADMIN can list participants for this hackathon.');
      else setError(e.message || 'Failed to load participants')
    }).finally(()=>setLoading(false));
  },[selected]);

  const filtered = participants.filter(p=> !q || `${p.displayName||p.userId||p.id} ${p.participationStatus||''}`.toLowerCase().includes(q.toLowerCase()));

  if(initialLoading) return <div className="h-64 animate-pulse rounded-2xl bg-[#e9e5da]"/>

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/organizer/dashboard" className="rounded-xl border border-[#dedbd1] bg-[#fdfbf5] p-2"><ArrowLeft size={16}/></Link>
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[.18em] text-[#f26a4f]">Organizer · participants</div>
          <h1 className="text-2xl font-bold tracking-[-.04em]">Participants</h1>
          <p className="text-xs text-[#77798a]">GET /hackathons/:id/participants — organizer view, ownership-checked. Privacy: participants are public but emails hidden.</p>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex-1 text-sm font-semibold">Hackathon<select value={selected} onChange={e=>setSelected(e.target.value)} className="hmt-input">{hackathons.map(h=> <option key={h.id} value={h.id}>{h.title} — {h.status}</option>)}{hackathons.length===0 && <option value="">No hackathons</option>}</select></label>
        <label className="relative flex-1 text-sm font-semibold">Search<div className="relative"><Search size={14} className="absolute left-3 top-3 text-[#aaa9a2]"/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Filter by name or status" className="hmt-input pl-9 mt-1"/></div></label>
        <button onClick={()=> selected && organizerApi.listParticipants(selected).then(setParticipants).catch((e:any)=>setError(e.message))} className="rounded-xl border border-[#dedbd1] bg-[#fdfbf5] px-4 py-3 text-xs font-bold">Refresh</button>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex gap-2"><AlertCircle size={16}/>{error}</div>}
      {loading ? <div className="flex items-center gap-2 text-sm text-[#77798a]"><Loader2 size={16} className="animate-spin"/> Loading participants…</div> : null}

      {!loading && !error && filtered.length===0 ? (
        <div className="rounded-2xl border border-dashed border-[#dedbd1] bg-[#fdfbf5] p-8 text-center">
          <div className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-[#f4f1e8]"><Users size={18}/></div>
          <h3 className="mt-3 font-bold">No participants yet</h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-[#77798a]">When participants join the hackathon, they appear here. You can also seed demo data from the hackathon detail workspace.</p>
          {selected && <button onClick={async()=>{ try{ await organizerApi.seedDemo(selected); const p=await organizerApi.listParticipants(selected); setParticipants(p)}catch(e:any){setError(e.message)}}} className="mt-4 rounded-xl bg-[#171a2d] px-4 py-2 text-xs font-bold text-white">Seed demo participants</button>}
        </div>
      ) : null}

      {!loading && filtered.length>0 && (
        <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[#e5e1d7] text-left font-mono text-[11px] uppercase tracking-wider text-[#77798a]"><th className="px-4 py-3">Display name</th><th className="px-4 py-3">Team</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Joined</th><th className="px-4 py-3">Id</th></tr></thead>
              <tbody>
                {filtered.map((p:any)=>(
                  <tr key={p.id} className="border-b border-[#e5e1d7]/60 last:border-0 hover:bg-[#f4f1e8]">
                    <td className="px-4 py-3 font-semibold">{p.displayName || p.userId || '—'}</td>
                    <td className="px-4 py-3 text-xs">{p.teamId ? <span className="rounded-full bg-[#e9e5da] px-2 py-1 text-[10px] font-bold">{p.teamId.slice(0,8)}</span> : <span className="text-[#77798a]">No team</span>}</td>
                    <td className="px-4 py-3"><Badge tone={p.participationStatus==='ACTIVE'?'blue':'muted'}>{p.participationStatus || '—'}</Badge></td>
                    <td className="px-4 py-3 text-xs text-[#77798a]">{p.joinedAt ? new Date(p.joinedAt).toLocaleDateString() : '—'}</td>
                    <td className="px-4 py-3 font-mono text-xs text-[#77798a]">{p.id.slice(0,8)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-[#e5e1d7] bg-[#f4f1e8] px-4 py-3 flex items-center gap-2 text-xs text-[#77798a]"><ShieldCheck size={14} className="text-[#5aafbd]"/>{filtered.length} participants · GET /hackathons/{selected.slice(0,8)}/participants · privacy-safe (no emails, no private repos)</div>
        </div>
      )}
    </div>
  )
}
