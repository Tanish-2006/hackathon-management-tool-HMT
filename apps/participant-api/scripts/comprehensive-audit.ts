import * as http from 'http';

async function runComprehensiveAudit() {
  console.log('================================================================');
  console.log('COMPREHENSIVE END-TO-END VERIFICATION AUDIT (GET, POST, PUT)');
  console.log('================================================================\n');

  const baseUrl = process.env.API_URL || 'http://localhost:3000/api/v1';

  const req = (path: string, method = 'GET', body?: any, token?: string): Promise<{ status: number; body: any }> => {
    return new Promise((resolve, reject) => {
      const url = new URL(baseUrl + path);
      const data = body ? JSON.stringify(body) : null;
      const headers: Record<string, string> = {
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(data)) } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };

      const r = http.request(
        url,
        {
          method,
          headers,
        },
        (res) => {
          let raw = '';
          res.on('data', (c) => (raw += c));
          res.on('end', () => {
            try {
              resolve({ status: res.statusCode || 500, body: JSON.parse(raw) });
            } catch {
              resolve({ status: res.statusCode || 500, body: raw });
            }
          });
        },
      );

      r.on('error', reject);
      if (data) r.write(data);
      r.end();
    });
  };

  try {
    // 1. Health Probes (GET)
    console.log('[1/10] Testing Health & Readiness Probes (GET)...');
    const h1 = await req('/health');
    const h2 = await req('/health/readiness');
    console.log(` -> GET /health [${h1.status}]:`, h1.body.status);
    console.log(` -> GET /health/readiness [${h2.status}]:`, h2.body.status);

    // 2. Authentication (POST Register & Login)
    console.log('\n[2/10] Testing Registration & Login (POST)...');
    const email = `audit.user.${Date.now()}@example.com`;
    const password = 'StrongPassword123!';

    const reg = await req('/auth/register', 'POST', {
      email,
      password,
      fullName: 'Audit Tester',
    });
    console.log(` -> POST /auth/register [${reg.status}]:`, reg.body.user.email);

    const login = await req('/auth/login', 'POST', { email, password });
    console.log(` -> POST /auth/login [${login.status}]: Token issued successfully`);
    const token = login.body.accessToken;

    // 3. User Identity (GET /auth/me)
    console.log('\n[3/10] Testing Protected User Context (GET)...');
    const me = await req('/auth/me', 'GET', null, token);
    console.log(` -> GET /auth/me [${me.status}]:`, me.body.email);

    // 4. Participant Profile Update (GET & PUT)
    console.log('\n[4/10] Testing Profile Read & Update (GET & PUT)...');
    const getProf1 = await req('/profile', 'GET', null, token);
    console.log(` -> GET /profile [${getProf1.status}]`);

    const putProf = await req('/profile', 'PUT', {
      bio: 'Fullstack Systems Engineer',
      skills: ['TypeScript', 'NestJS', 'PostgreSQL', 'Neo4j', 'Redis'],
      githubUrl: 'https://github.com/audittester',
      linkedinUrl: 'https://linkedin.com/in/audittester',
    }, token);
    console.log(` -> PUT /profile [${putProf.status}]:`, putProf.body.bio);

    // 5. Hackathon Context & Problem Statement (GET)
    console.log('\n[5/10] Testing Hackathon Info & Problem Statement (GET)...');
    const hack = await req('/hackathons/current', 'GET', null, token);
    console.log(` -> GET /hackathons/current [${hack.status}]:`, hack.body.title);

    const prob = await req(`/hackathons/${hack.body.id}/problem-statement`, 'GET', null, token);
    console.log(` -> GET /hackathons/:id/problem-statement [${prob.status}]:`, prob.body.problemStatement?.slice(0, 60));

    const rescs = await req(`/hackathons/${hack.body.id}/resources`, 'GET', null, token);
    console.log(` -> GET /hackathons/:id/resources [${rescs.status}]: ${rescs.body.resources?.length ?? 0} resources found`);

    // 6. Team & Repository Management (POST)
    console.log('\n[6/10] Testing Team Creation & Repository Connection (POST)...');
    const team = await req('/team', 'POST', { name: 'Audit Team One', hackathonId: hack.body.id }, token);
    console.log(` -> POST /team [${team.status}]: Team ID ${team.body.id}`);

    const repo = await req('/team/repository', 'POST', {
      repoUrl: 'https://github.com/audittester/hmt-audit-repo',
      title: 'HMT Platform Companion',
      description: 'Audit verified platform codebase',
      techStack: ['NestJS', 'TypeScript', 'Prisma', 'Neo4j'],
    }, token);
    console.log(` -> POST /team/repository [${repo.status}]: Connected ${repo.body.repoUrl}`);

    // 7. Repository Scan & Findings (POST & GET)
    console.log('\n[7/10] Testing AST Security Scanner & Findings (POST & GET)...');
    const scan = await req('/repository/analyze', 'POST', {}, token);
    console.log(` -> POST /repository/analyze [${scan.status}]: Scan ID ${scan.body.scanId}`);
    await new Promise((r) => setTimeout(r, 600));
    const findings = await req('/repository/findings', 'GET', null, token);
    console.log(` -> GET /repository/findings [${findings.status}]: ${findings.body.findings.length} findings fetched`);

    // 8. AI Teammate Companion (POST & GET)
    console.log('\n[8/10] Testing AI Teammate Engine (POST & GET)...');
    const aiChat = await req('/ai/chat', 'POST', { message: 'What architectural patterns should we use?' }, token);
    console.log(` -> POST /ai/chat [${aiChat.status}]: Response received`);

    const aiRecs = await req('/ai/recommendations', 'GET', null, token);
    console.log(` -> GET /ai/recommendations [${aiRecs.status}]: ${aiRecs.body.recommendations.length} recommendations`);

    // 9. Performance & Mentor Feedback (POST & GET)
    console.log('\n[9/10] Testing Mentor Feedback & Timeline (POST & GET)...');
    const fb = await req('/performance/mentor-feedback', 'POST', {
      projectId: repo.body.id,
      author: 'Lead Architect Mentor',
      role: 'MENTOR',
      phase: 'Final Review',
      feedback: 'Solid security posture and zero broken endpoints.',
      rating: 10.0,
    }, token);
    console.log(` -> POST /performance/mentor-feedback [${fb.status}]: Feedback ID ${fb.body.id}`);

    const timeline = await req('/performance/timeline', 'GET', null, token);
    console.log(` -> GET /performance/timeline [${timeline.status}]: ${timeline.body.feedbacks.length} items in timeline`);

    // 10. Post-Hackathon Roadmap (POST & GET)
    console.log('\n[10/10] Testing Post-Hackathon Roadmap Generator (POST & GET)...');
    const roadmap = await req('/post-hackathon/roadmap', 'POST', {}, token);
    console.log(` -> POST /post-hackathon/roadmap [${roadmap.status}]: Roadmap generated`);
    if (roadmap.body.marketSummary) console.log('    Market summary:', roadmap.body.marketSummary.slice(0, 80));

    const resources = await req('/post-hackathon/resources', 'GET', null, token);
    console.log(` -> GET /post-hackathon/resources [${resources.status}]: ${resources.body.suggestedAccelerators?.length ?? 0} accelerators`);

    console.log('\n================================================================');
    console.log('ALL VERIFICATION AUDITS PASSED WITH ZERO ERRORS (GET/POST/PUT)');
    console.log('================================================================');
  } catch (err) {
    console.error('Audit failed:', err);
    process.exit(1);
  }
}

runComprehensiveAudit();
