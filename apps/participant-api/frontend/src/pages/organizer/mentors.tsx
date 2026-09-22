import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { AlertCircle, ArrowLeft, ChevronRight, ExternalLink, Loader2, Search, ShieldCheck, Users } from 'lucide-react';
import { organizerApi, OrganizerApiError } from '@/services/organizerApi';

export default function OrganizerMentors(){
  const [hackathons,setHackathons]=useState<any[]>([]);
  const [selected,setSelected]=useState<string>('');
  const [assignments,setAssignments]=useState<any[]>([]);
  const [q,setQ]=useState('');
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [initial,setInitial]=useState(true);
  const [assignForm,setAssignForm]=useState({mentorId:'',teamId:''});
  const [assignMsg,setAssignMsg]=useState<string|null>(null);

  useEffect(()=>{
    async function init(){ try{ const l=await organizerApi.listHackathons(); setHackathons(l); if(l[0]) setSelected(l[0].id)}catch(e:any){setError(e.message)} finally{setInitial(false)}}
    init();
  },[]);
  useEffect(()=>{
    if(!selected) return;
    setLoading(true); setError(null);
    organizerApi.listMentorAssignments(selected).then(setAssignments).catch((e:any)=> setError(e.message)).finally(()=> setLoading(false))
  },[selected]);

  const filtered = assignments.filter(a=> !q || `${a.mentorId} ${a.teamId}`.toLowerCase().includes(q.toLowerCase()));

  const doAssign = async()=>{
    if(!selected) {setError('Select hackathon'); return}
    if(!assignForm.mentorId.trim() || !assignForm.teamId.trim()){setError('mentorId and teamId required'); return}
    setLoading(true); setError(null); setAssignMsg(null);
    try{
      const a=await organizerApi.assignMentor(selected, {mentorId:assignForm.mentorId, teamId:assignForm.teamId});
      setAssignments(prev=>[...prev, a]);
      setAssignMsg(`Assigned mentor ${a.mentorId.slice(0,8)} → team ${a.teamId.slice(0,8)}`);
      setAssignForm({mentorId:'',teamId:''});
    }catch(e:any){ setError(e.message)} finally{ setLoading(false)}
  }

  if(initial) return <div className="h-64 animate-pulse rounded-2xl bg-[#e9e5da]"/>

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/organizer/dashboard" className="rounded-xl border border-[#dedbd1] bg-[#fdfbf5] p-2"><ArrowLeft size={16}/></Link>
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[.18em] text-[#f26a4f]">Organizer · mentors</div>
          <h1 className="text-2xl font-bold">Mentors</h1>
          <p className="text-xs text-[#77798a]">GET /hackathons/:id/mentor-assignments — organizer assigns mentor to team (POST). Mentor can only see assigned teams (403 otherwise).</p>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="flex-1 text-sm font-semibold">Hackathon<select value={selected} onChange={e=>setSelected(e.target.value)} className="hmt-input">{hackathons.map(h=> <option key={h.id} value={h.id}>{h.title} — {h.status}</option>)}</select></label>
        <label className="relative flex-1 text-sm font-semibold">Search<div className="relative"><Search size={14} className="absolute left-3 top-3 text-[#aaa9a2]"/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Filter mentorId or teamId" className="hmt-input pl-9 mt-1"/></div></label>
      </div>

      <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-5">
        <h3 className="font-bold text-sm">Assign mentor to team</h3>
        <p className="mt-1 text-xs text-[#77798a]">POST /hackathons/:id/mentor-assignments with mentorId (user id) and teamId. Teams can be seeded via hackathon detail → Seed demo.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-semibold">Mentor user id<input value={assignForm.mentorId} onChange={e=>setAssignForm(p=>({...p,mentorId:e.target.value}))} placeholder="mentor uuid" className="hmt-input"/></label>
          <label className="text-sm font-semibold">Team id<input value={assignForm.teamId} onChange={e=>setAssignForm(p=>({...p,teamId:e.target.value}))} placeholder="team_xxx" className="hmt-input"/></label>
        </div>
        <div className="mt-3 flex gap-2">
          <button onClick={doAssign} disabled={loading} className="rounded-xl bg-[#171a2d] px-4 py-2 text-xs font-bold text-white disabled:opacity-50">{loading?'Assigning…':'Assign mentor'}</button>
          {selected && <button onClick={async()=>{ try{ await organizerApi.seedDemo(selected); const t=await organizerApi.listTeams(selected); if(t[0]) setAssignForm(p=>({...p,teamId:t[0].id})); setAssignMsg('Seeded demo teams — teamId auto-filled'); }catch(e:any){setError(e.message)}}} className="rounded-xl border border-[#dedbd1] px-3 py-2 text-xs font-semibold">Seed demo</button>}
          <Link href="/organizer/feedback" className="rounded-xl border border-[#dedbd1] px-3 py-2 text-xs font-semibold">Feedback workflow</Link>
        </div>
        {assignMsg && <div className="mt-3 rounded-xl bg-emerald-50 border border-emerald-200 p-2 text-xs text-emerald-700">{assignMsg}</div>}
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex gap-2"><AlertCircle size={16}/>{error}</div>}
      {loading && <div className="flex items-center gap-2 text-sm text-[#77798a]"><Loader2 size={16} className="animate-spin"/> Loading assignments…</div>}

      {!loading && !error && filtered.length===0 ? (
        <div className="rounded-2xl border border-dashed border-[#dedbd1] bg-[#fdfbf5] p-8 text-center">
          <div className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-[#f4f1e8]"><Users size={18}/></div>
          <h3 className="mt-3 font-bold">No mentor assignments yet</h3>
          <p className="text-sm text-[#77798a]">Assign mentors above. Each mentor will only be able to submit feedback for assigned teams (permission-aware).</p>
        </div>
      ) : null}

      {!loading && filtered.length>0 && (
        <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[#e5e1d7] text-left font-mono text-[11px] uppercase tracking-wider text-[#77798a]"><th className="px-4 py-3">Mentor</th><th className="px-4 py-3">Team</th><th className="px-4 py-3">Assigned at</th><th className="px-4 py-3">Hackathon</th><th className="px-4 py-3 text-right">Actions</th></tr></thead>
              <tbody>
                {filtered.map((a:any)=>(
                  <tr key={a.id} className="border-b border-[#e5e1d7]/60 last:border-0 hover:bg-[#f4f1e8]">
                    <td className="px-4 py-3 font-mono text-xs">{a.mentorId.slice(0,12)}…</td>
                    <td className="px-4 py-3 font-mono text-xs">{a.teamId.slice(0,12)}…</td>
                    <td className="px-4 py-3 text-xs text-[#77798a]">{new Date(a.assignedAt).toLocaleString()}</td>
                    <td className="px-4 py-3 text-xs">{a.hackathonId.slice(0,8)}</td>
                    <td className="px-4 py-3 text-right"><button onClick={async()=>{ try{ const teams=await organizerApi.listMentorTeams(a.mentorId); alert(`Mentor ${a.mentorId.slice(0,8)} has ${teams.length} team(s)`)}catch(e:any){alert(e.message)}}} className="rounded-lg border border-[#dedbd1] px-2 py-1 text-xs font-bold">View teams <ChevronRight size={12} className="inline"/></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-[#e5e1d7] bg-[#f4f1e8] px-4 py-3 flex items-center gap-2 text-xs text-[#77798a]"><ShieldCheck size={14} className="text-[#5aafbd]"/>{filtered.length} assignments · GET /hackathons/{selected.slice(0,8)}/mentor-assignments · Permission: mentor sees own, organizer sees all.</div>
        </div>
      )}
    </div>
  )
}
