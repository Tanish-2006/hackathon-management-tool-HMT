import { Link } from 'wouter';
import { BookOpen, Play, FileText, Award, ArrowRight, Sparkles, Target, Trophy, Layers, Clock3, Check } from 'lucide-react';
import { motion } from 'framer-motion';

export default function ParticipantLearning(){
  const modules = [
    { id:'m1', title:'Shipping under pressure', level:'Foundations', duration:'18 min', progress: 100, color:'#d8e35b', desc:'Turn constraints into clarity. A 3-act framework for the 48-hour sprint.' },
    { id:'m2', title:'AI Teammate: hints → decisions', level:'AI workflow', duration:'22 min', progress: 64, color:'#f26a4f', desc:'Use targeted retrieval (≤3 files) to ask better questions, not for code.' },
    { id:'m3', title:'Read-only security mindset', level:'Security', duration:'14 min', progress: 0, color:'#5aafbd', desc:'Why tokens stay encrypted, why grants matter, why repo is read-only.' },
    { id:'m4', title:'Judging criteria decoded', level:'Strategy', duration:'16 min', progress: 0, color:'#171a2d', desc:'Technical Depth 35 · AI Teammate 35 · UX 30 — how to make them visible.' },
  ];
  const resources = [
    { name:'Participant API Specs', url:'/docs/API_CONTRACT.md', tag:'Docs' },
    { name:'Neo4j Graph Schema', url:'/docs/ARCHITECTURE.md', tag:'Architecture' },
    { name:'AST Scan playbook', url:'#', tag:'Guide' },
  ];
  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[.18em] text-[#f26a4f]">Learning · Post-hackathon growth</div>
          <h1 className="mt-2 text-3xl font-bold tracking-[-.05em] text-[#171a2d]">Learn faster than you ship.</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#77798a]">Curated micro-learning tied to your performance history — mistakes, feedback and improvement areas become lessons.</p>
        </div>
        <Link href="/participant/performance" className="rounded-xl bg-[#171a2d] px-4 py-2 text-xs font-bold text-white">View my performance</Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.35fr_.65fr]">
        <div className="rounded-2xl bg-[#171a2d] p-6 text-[#fdfbf5] sm:p-8">
          <div className="font-mono text-[10px] uppercase tracking-[.16em] text-[#d8e35b]">Recommended path</div>
          <h2 className="mt-3 text-2xl font-bold tracking-tight">From build to breakthrough</h2>
          <p className="mt-2 text-sm leading-6 text-[#b9bdca]">Based on your build, start with AI workflow and judging criteria. Each module is 10–22 minutes, built for momentum.</p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {modules.slice(0,2).map((m,i)=>(
              <div key={m.id} className="rounded-xl bg-[#252941] p-4">
                <div className="flex items-center justify-between"><span className="rounded-full px-2 py-1 text-[10px] font-bold" style={{ background:m.color, color:'#171a2d' }}>{m.level}</span><span className="font-mono text-[11px] text-[#9b9fb1]">{m.duration}</span></div>
                <h3 className="mt-3 font-bold">{m.title}</h3>
                <p className="mt-1 text-xs leading-5 text-[#9b9fb1]">{m.desc}</p>
                <div className="mt-3 h-1.5 rounded-full bg-[#3a3e5a]"><div className="h-full rounded-full" style={{ width:`${m.progress}%`, background:m.color }}/></div>
                <div className="mt-1 text-[11px] text-[#9b9fb1]">{m.progress}% complete</div>
              </div>
            ))}
          </div>
          <Link href="/participant/performance" className="mt-6 inline-flex items-center gap-2 text-sm font-bold text-[#d8e35b]">Personalize from my mistakes <ArrowRight size={14}/></Link>
        </div>

        <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-6">
          <h3 className="font-bold flex items-center gap-2"><Trophy size={16}/> Your next edge</h3>
          <div className="mt-4 space-y-3">
            <div className="rounded-xl bg-[#f4f1e8] p-4"><div className="text-xs font-bold">Post-hackathon roadmap</div><p className="mt-1 text-xs leading-5 text-[#77798a]">Turn your hackathon project into a venture-ready roadmap (POST /post-hackathon/roadmap).</p><Link href="/participant/projects" className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-[#f26a4f]">Generate roadmap <ArrowRight size={12}/></Link></div>
            <div className="rounded-xl border border-[#e5e1d7] p-4"><div className="text-xs font-bold flex items-center gap-2"><Target size={14}/> Improvement areas</div><p className="mt-1 text-xs text-[#77798a]">Your published improvements become the next module queue.</p></div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-6">
        <div className="flex items-center justify-between"><h3 className="font-bold flex items-center gap-2"><BookOpen size={16}/> All modules</h3><span className="font-mono text-xs text-[#77798a]">{modules.length} modules · Self-paced</span></div>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {modules.map((m,i)=>(
            <motion.div key={m.id} initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} transition={{delay:i*0.05}} className="rounded-2xl border border-[#e5e1d7] p-5 bg-white hover:border-[#f26a4f]/50 transition-colors">
              <div className="flex items-start justify-between gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-xl text-white" style={{background:m.color}}><Play size={16} className={m.color==='#d8e35b'?'text-[#171a2d]':''}/></div>
                <span className="rounded-full bg-[#f4f1e8] px-2.5 py-1 text-[11px] font-bold">{m.level}</span>
              </div>
              <h4 className="mt-4 font-bold">{m.title}</h4>
              <p className="mt-1 text-xs leading-5 text-[#77798a]">{m.desc}</p>
              <div className="mt-4 flex items-center justify-between text-xs"><span className="flex items-center gap-1 text-[#77798a]"><Clock3 size={12}/>{m.duration}</span><span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-bold ${m.progress===100?'bg-emerald-100 text-emerald-700':'bg-[#e9e5da] text-[#77798a]'}`}>{m.progress===100?<Check size={12}/>:null}{m.progress===100?'Done':`${m.progress}%`}</span></div>
              <button className="mt-4 w-full rounded-xl bg-[#171a2d] px-3 py-2 text-xs font-bold text-white">Continue</button>
            </motion.div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-6">
        <h3 className="font-bold">Resources</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {resources.map(r=>(
            <a key={r.name} href={r.url} target="_blank" rel="noreferrer" className="rounded-xl border border-[#e5e1d7] p-4 hover:bg-[#f4f1e8] flex flex-col gap-2">
              <span className="rounded-full bg-[#f26a4f] px-2 py-1 text-[10px] font-bold text-white w-fit">{r.tag}</span>
              <span className="text-sm font-bold">{r.name}</span>
              <span className="text-xs text-[#5aafbd] inline-flex items-center gap-1">Open <ArrowRight size={12}/></span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
