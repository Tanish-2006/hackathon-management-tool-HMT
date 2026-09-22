export type Role = 'Organizer' | 'Participant' | 'Judge' | 'Sponsor';
export type Hackathon = { id: string; name: string; edition: string; status: 'Live' | 'Planning' | 'Completed'; date: string; location: string; teams: number; submissions: number; accent: string; description: string };
export type Team = { id: string; name: string; project: string; track: string; score: number; members: string[]; status: string };

export const mockHackathons: Hackathon[] = [
  { id: 'orbit-26', name: 'Orbit / 26', edition: 'Spring edition', status: 'Live', date: 'Apr 18–20, 2026', location: 'Online + 14 hubs', teams: 84, submissions: 61, accent: '#d8e35b', description: 'A 48-hour build sprint for people shaping the next layer of the internet.' },
  { id: 'signal-lab', name: 'Signal Lab', edition: 'Powered by Arc', status: 'Planning', date: 'Jun 06–08, 2026', location: 'Berlin, DE', teams: 0, submissions: 0, accent: '#f26a4f', description: 'Make the invisible visible. An open call for tools that turn noise into signal.' },
  { id: 'civic-stack', name: 'Civic Stack', edition: 'Fall edition', status: 'Completed', date: 'Oct 11–13, 2025', location: 'Lisbon, PT', teams: 112, submissions: 97, accent: '#5aafbd', description: 'Builders making public systems easier to understand and use.' },
];

export const mockTeams: Team[] = [
  { id: 't-01', name: 'soft launch', project: 'Afterimage', track: 'Open web', score: 94.6, members: ['AR', 'MK', 'JL'], status: 'Finalist' },
  { id: 't-02', name: 'ctrl alt elite', project: 'Threadline', track: 'AI & data', score: 92.8, members: ['NS', 'BK', 'QT', 'YR'], status: 'Finalist' },
  { id: 't-03', name: 'Cache Money', project: 'Lumen', track: 'Climate', score: 90.4, members: ['EV', 'OM'], status: 'Reviewed' },
  { id: 't-04', name: '404 Founders', project: 'Common Ground', track: 'Civic tech', score: 88.9, members: ['PW', 'SA', 'LN'], status: 'Reviewed' },
  { id: 't-05', name: 'the semicolons', project: 'Sonic Bloom', track: 'Creative tech', score: 86.2, members: ['DC', 'IM'], status: 'Reviewed' },
];

export const participantTasks = [
  { id: 'task-1', label: 'Complete team profile', detail: 'Tell judges who is building what', done: true },
  { id: 'task-2', label: 'Submit a demo link', detail: 'A public URL helps reviewers explore', done: false },
  { id: 'task-3', label: 'Add your project story', detail: 'Keep it crisp: problem, insight, proof', done: false },
];

export const milestones = [
  { day: 'TODAY', time: '18:00', label: 'Submission window closes', tone: 'coral' },
  { day: 'TOMORROW', time: '09:30', label: 'Judging room opens', tone: 'lime' },
  { day: 'APR 20', time: '16:00', label: 'Winners announced', tone: 'blue' },
];