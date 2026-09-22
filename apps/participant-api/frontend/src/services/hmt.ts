import { mockHackathons, mockTeams, type Hackathon, type Role, type Team } from '@/mocks/hmt';

const wait = (ms = 240) => new Promise(resolve => setTimeout(resolve, ms));
const key = 'hmt-created-hackathons';

export const hmtService = {
  async getHackathons(): Promise<Hackathon[]> {
    await wait();
    const local = JSON.parse(localStorage.getItem(key) || '[]') as Hackathon[];
    return [...local, ...mockHackathons];
  },
  async getHackathon(id: string) {
    const items = await this.getHackathons();
    return items.find(item => item.id === id) || mockHackathons[0];
  },
  async getLeaderboard(): Promise<Team[]> { await wait(160); return mockTeams; },
  async createHackathon(input: { name: string; description: string; date: string; location: string; track: string; role: Role }): Promise<Hackathon> {
    await wait(700);
    const created: Hackathon = { id: `h-${Date.now()}`, name: input.name, edition: input.track, status: 'Planning', date: input.date, location: input.location, teams: 0, submissions: 0, accent: '#f26a4f', description: input.description };
    const local = JSON.parse(localStorage.getItem(key) || '[]') as Hackathon[];
    localStorage.setItem(key, JSON.stringify([created, ...local]));
    return created;
  },
};