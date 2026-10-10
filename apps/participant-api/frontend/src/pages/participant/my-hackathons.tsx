import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { ArrowRight, Clock3, Loader2, AlertCircle, Sparkles } from 'lucide-react';
import { hmtBackendService, ApiError } from '@/services/backendApi';
import { cn } from '@/lib/utils';

function Badge({ children, tone='muted' }: any){
  const m:any={ lime:'bg-[#d8e35b] text-[#171a2d]', coral:'bg-[#f26a4f] text-white', blue:'bg-[#5aafbd] text-white', dark:'bg-[#171a2d] text-white', muted:'bg-[#e9e5da] text-[#77798a]' }
  return <span className={cn("rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider", m[tone]||m.muted)}>{children}</span>
}

const BUCKETS = ['all','upcoming','live','completed','registered'] as const;

export default function MyHackathons(){
  const [rows,setRows]=useState<any[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);
  const [bucket,setBucket]=useState<typeof BUCKETS[number]>('all');

  async function load(b: string){
    setLoading(true); setError(null);
    try{
      const res = await hmtBackendService.getMyHackathons(b==='all'?undefined:b);
      setRows(Array.isArray(res) ? res : res?.data ?? []);
    }catch(e){ setError(e instanceof ApiError?e.message:(e as Error)?.message||'Failed'); }
    finally{ setLoading(false); }
  }

  useEffect(()=>{ load(bucket); },[bucket]);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[.18em] text-[#f26a4f]">My Hackathons</div>
          <h1 className="mt-2 text-3xl font-bold tracking-[-.05em] text-[#171a2d]">Your hackathons</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-[#77798a]">Everything you've registered for, from upcoming to completed.</p>
        </div>
        <Link href="/participant/hackathons" className="rounded-xl border border-[#dedbd1] px-4 py-2 text-xs font-bold">Discover more</Link>
      </div>
      <div className="flex flex-wrap gap-2">
        {BUCKETS.map(b=><button key={b} onClick={()=>setBucket(b)} className={cn("rounded-full px-3 py-1.5 text-[11px] font-bold capitalize", bucket===b?"bg-[#171a2d] text-white":"bg-[#f4f1e8] text-[#55586a]")}>{b}</button>)}
      </div>
      {loading ? <div className="flex items-center gap-2 text-sm text-[#77798a]"><Loader2 size={16} className="animate-spin"/> Loading…</div>
      : error ? <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700 flex gap-3"><AlertCircle size={18}/><div><b>Could not load</b><p className="mt-1">{error}</p></div></div>
      : rows.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {rows.map(r=>(
            <div key={r.id} className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-bold">{r.title}</h3>
                <Badge tone={r.bucket==='live'?'coral':r.bucket==='completed'?'muted':'lime'}>{r.derivedStatus}</Badge>
              </div>
              <div className="mt-2 flex items-center gap-2 text-xs text-[#77798a]"><Clock3 size={12}/> {r.eventEnd?`Ends ${new Date(r.eventEnd).toLocaleDateString()}`:'—'} · {r.mode} · {r.registrationStatus}</div>
              {r.bucket!=='completed' && (
                <div className="mt-3 rounded-xl bg-[#171a2d] p-3 text-xs text-[#fdfbf5]">
                  <div className="flex items-center gap-2 font-bold"><Sparkles size={13} className="text-[#d8e35b]"/> AI Helper</div>
                  <div className="mt-1 text-[#9b9fb1]">Work through the current ideation round with your team or on your own.</div>
                  <div className="mt-2 flex gap-2">
                    <Link href={`/participant/ai-helper?hackathon=${r.id}`} className="rounded-lg bg-[#d8e35b] px-3 py-1.5 font-bold text-[#171a2d]">Open AI Helper</Link>
                    <Link href="/participant/projects" className="rounded-lg border border-[#3a3e5a] px-3 py-1.5">Project</Link>
                  </div>
                </div>
              )}
              <div className="mt-3 flex gap-2">
                <Link href="/participant/hackathons" className="inline-flex items-center gap-1 text-xs font-bold">Details <ArrowRight size={13}/></Link>
                <Link href="/participant/teams" className="text-xs font-semibold text-[#5aafbd] underline">Team</Link>
              </div>
            </div>
          ))}
        </div>
      ) : <div className="rounded-2xl border border-dashed border-[#dedbd1] p-8 text-center text-sm text-[#77798a]">No hackathons here yet. Discover and register to begin.</div>}
    </div>
  );
}
