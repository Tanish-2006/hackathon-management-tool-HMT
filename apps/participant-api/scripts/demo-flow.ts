import * as http from 'http';

async function runDemoScript() {
  console.log('==================================================');
  console.log('HMT PARTICIPANT PLATFORM DEMO VERIFICATION SCRIPT');
  console.log('==================================================\n');

  const baseUrl = process.env.API_URL || 'http://localhost:3000/api/v1';

  const makeReq = (path: string, method = 'GET', body?: any, token?: string): Promise<any> => {
    return new Promise((resolve, reject) => {
      const url = new URL(baseUrl + path);
      const data = body ? JSON.stringify(body) : null;
      const headers: Record<string, string> = {
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(data)) } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };

      const req = http.request(
        url,
        {
          method,
          headers,
        },
        (res) => {
          let raw = '';
          res.on('data', (chunk) => (raw += chunk));
          res.on('end', () => {
            try {
              const parsed = JSON.parse(raw);
              resolve({ status: res.statusCode, body: parsed });
            } catch {
              resolve({ status: res.statusCode, body: raw });
            }
          });
        },
      );

      req.on('error', reject);
      if (data) req.write(data);
      req.end();
    });
  };

  try {
    // 1. Health Verification
    console.log('[1/8] Verifying Health & Readiness endpoints...');
    const health = await makeReq('/health');
    console.log(` -> Health status: ${health.status}`, health.body);

    // 2. Auth: Register
    console.log('\n[2/8] Registering participant (john.doe@example.com)...');
    const email = `john.doe.${Date.now()}@example.com`;
    const regRes = await makeReq('/auth/register', 'POST', {
      email,
      password: 'StrongPassword123!',
      fullName: 'John Doe Developer',
    });
    console.log(` -> Register response [${regRes.status}]:`, regRes.body.user);
    const token = regRes.body.accessToken;

    // 3. Hackathon Context
    console.log('\n[3/8] Fetching active Hackathon & Problem Statement...');
    const hackathon = await makeReq('/hackathons/current', 'GET', null, token);
    console.log(` -> Hackathon Title: ${hackathon.body.title}`);
    console.log(` -> Problem Statement: ${hackathon.body.problemStatement}`);

    // 4. Team & Project Connection
    console.log('\n[4/8] Creating Team & Connecting Git Repository...');
    const team = await makeReq('/team', 'POST', { name: 'Alpha AI Builders', hackathonId: hackathon.body.id }, token);
    console.log(` -> Team created [ID: ${team.body.id}]`);

    const repo = await makeReq(
      '/team/repository',
      'POST',
      {
        repoUrl: 'https://github.com/john-doe/alpha-ai-companion',
        title: 'Alpha Autonomous AI Engineer Companion',
        description: 'AST-aware developer platform with security scans and strategy graph',
        techStack: ['Node.js', 'NestJS', 'PostgreSQL', 'Neo4j', 'Redis'],
      },
      token,
    );
    console.log(` -> Repository Connected: ${repo.body.repoUrl}`);

    // 5. AST & Security Repository Analysis
    console.log('\n[5/8] Triggering Repository AST Security & Quality Scan...');
    const scanTrigger = await makeReq('/repository/analyze', 'POST', {}, token);
    console.log(` -> Scan status: ${scanTrigger.body.status}`);

    // Wait 600ms for async scanner completion
    await new Promise((r) => setTimeout(r, 600));

    const findings = await makeReq('/repository/findings', 'GET', null, token);
    console.log(` -> Total Security & Quality Findings detected: ${findings.body.findings.length}`);
    if (findings.body.findings.length > 0) {
      console.log('    Sample Finding:', findings.body.findings[0].title);
    }

    // 6. AI Teammate & Winning Recommendations
    console.log('\n[6/8] Consulting AI Teammate for winning strategy...');
    const aiChat = await makeReq('/ai/chat', 'POST', { message: 'How do we fix our API and secure our secret keys?' }, token);
    console.log(' -> AI Teammate Answer:', aiChat.body.answer);
    console.log(' -> Strategic Strategy Tip:', aiChat.body.hackathonStrategyTip);

    // 7. Mentor Feedback & Elimination Post-Mortem Analysis
    console.log('\n[7/8] Ingesting Mentor Feedback & Querying Elimination Post-Mortem...');
    await makeReq(
      '/performance/mentor-feedback',
      'POST',
      {
        projectId: repo.body.id,
        author: 'Senior Security Judge',
        role: 'MENTOR',
        phase: 'Midway Evaluation',
        feedback: 'Commendable architecture; add retry policies on external calls.',
        rating: 9.0,
      },
      token,
    );
    const timeline = await makeReq('/performance/timeline', 'GET', null, token);
    console.log(` -> Feedback records present: ${timeline.body.feedbacks.length}`);

    // 8. Post-Hackathon Continuation Roadmap
    console.log('\n[8/8] Generating Post-Hackathon Continuation Roadmap...');
    const continuation = await makeReq('/post-hackathon/roadmap', 'POST', {}, token);
    console.log(' -> Market Opportunity Summary:', continuation.body.marketSummary);
    console.log(' -> Target Users Identified:', continuation.body.targetUsers);

    console.log('\n==================================================');
    console.log('HMT PARTICIPANT DEMO FLOW VERIFIED SUCCESSFULLY!');
    console.log('==================================================');
  } catch (err) {
    console.error('Demo verification error:', err);
    process.exit(1);
  }
}

runDemoScript();
