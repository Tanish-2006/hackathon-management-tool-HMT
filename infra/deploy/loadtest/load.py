import asyncio
import json
import os
import random
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import aiohttp

BASE = os.environ.get("LT_BASE", "http://127.0.0.1")
ORIGIN = os.environ.get("LT_ORIGIN", "http://68.221.114.148")
USERS = int(os.environ.get("LT_USERS", "400"))
TEAMS = int(os.environ.get("LT_TEAMS", "60"))
JOINERS = int(os.environ.get("LT_JOINERS", "280"))
REG_WINDOW = float(os.environ.get("LT_REG_WINDOW", "150"))
STEADY = float(os.environ.get("LT_STEADY", "720"))
RESTART_AT = float(os.environ.get("LT_RESTART_AT", "240"))
ROUND_AT = float(os.environ.get("LT_ROUND_AT", "480"))
SPIKE_USERS = int(os.environ.get("LT_SPIKE_USERS", "200"))
CONTAINER = os.environ.get("LT_CONTAINER", "hmt-participant-api-1")
OUT = os.environ.get("LT_OUT", "/lt/results")
PASSWORD = "Str0ngPass123!"


def percentile(values, q):
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, int(round(q * (len(ordered) - 1)))))
    return ordered[index]


class Recorder:
    def __init__(self, started):
        self.started = started
        self.rows = []
        self.phase = "setup"

    def add(self, name, status, ms):
        self.rows.append((round(time.time() - self.started, 3), self.phase, name, status, round(ms, 1)))

    def summary(self):
        groups = defaultdict(list)
        for _, phase, name, status, ms in self.rows:
            groups[(phase, name)].append((status, ms))
        lines = [f"{'phase':<9} {'endpoint':<26} {'n':>6} {'p50':>7} {'p95':>7} {'p99':>7} {'max':>7}  statuses"]
        for (phase, name), items in sorted(groups.items()):
            latencies = [ms for _, ms in items]
            statuses = defaultdict(int)
            for status, _ in items:
                statuses[status] += 1
            codes = " ".join(f"{k}:{v}" for k, v in sorted(statuses.items(), key=lambda kv: str(kv[0])))
            lines.append(
                f"{phase:<9} {name:<26} {len(items):>6} {percentile(latencies, .5):>7.0f} {percentile(latencies, .95):>7.0f}"
                f" {percentile(latencies, .99):>7.0f} {max(latencies):>7.0f}  {codes}"
            )
        return "\n".join(lines)

    def save(self):
        os.makedirs(OUT, exist_ok=True)
        with open(os.path.join(OUT, "requests.csv"), "w") as fh:
            fh.write("t,phase,name,status,ms\n")
            fh.writelines(f"{t},{p},{n},{s},{ms}\n" for t, p, n, s, ms in self.rows)


class Api:
    def __init__(self, session, recorder):
        self.session = session
        self.recorder = recorder

    async def call(self, method, path, name, body=None, token=None, headers=None):
        merged = {"Origin": ORIGIN, "Content-Type": "application/json"}
        if token:
            merged["Authorization"] = f"Bearer {token}"
        merged.update(headers or {})
        started = time.perf_counter()
        try:
            async with self.session.request(method, BASE + path, json=body, headers=merged) as res:
                text = await res.text()
                status = res.status
        except (aiohttp.ClientError, asyncio.TimeoutError) as error:
            text, status = str(error), 0
        ms = (time.perf_counter() - started) * 1000
        if status == 200 and text.startswith("event:") and "event: done" not in text:
            status = 599
        self.recorder.add(name, status, ms)
        try:
            return status, json.loads(text) if text and not text.startswith("event:") else text
        except ValueError:
            return status, text

    @staticmethod
    def data(payload):
        return payload.get("data", payload) if isinstance(payload, dict) else payload


class User:
    def __init__(self, index, stamp):
        self.index = index
        self.email = f"u{index}-{stamp}@load.hmt"
        self.phone = f"+1999{stamp[-5:]}{index:04d}"
        self.token = None
        self.refresh_token = None
        self.token_at = 0.0
        self.team = None
        self.sent = defaultdict(int)
        self.registered = False


class LoadTest:
    def __init__(self):
        self.stamp = str(int(time.time()))
        self.started = time.time()
        self.recorder = Recorder(self.started)
        self.users = [User(i, self.stamp) for i in range(USERS)]
        self.hid = None
        self.org = None
        self.teams = []
        self.stop = asyncio.Event()
        self.events = []

    def log(self, message):
        line = f"[{time.time() - self.started:7.1f}s] {message}"
        self.events.append(line)
        print(line, flush=True)

    async def organizer_setup(self):
        status, body = await self.api.call("POST", "/organizer/api/v1/auth/register", "org.register", {
            "email": f"org-{self.stamp}@load.hmt", "password": PASSWORD, "displayName": "Load Org",
            "fullName": "Load Org", "role": "ORGANIZER", "phoneNumber": f"+1998{self.stamp[-7:]}",
        })
        self.org = body["accessToken"]
        status, body = await self.api.call("POST", "/organizer/api/v1/hackathons/wizard/generate", "org.wizard", {
            "mode": "HYBRID", "about": f"LOADTEST Ideathon {self.stamp}: load test event",
            "hackathonType": "OPEN_INNOVATION", "eligibility": ["Students"],
            "durationPlus": "3 days\nIdeation only\nPrizes: best idea",
        }, self.org)
        hackathon = self.api.data(body)["hackathon"]
        self.hid = hackathon["id"]
        if not str(hackathon.get("title", "")).startswith("LOADTEST"):
            await self.api.call("PATCH", f"/organizer/api/v1/hackathons/{self.hid}", "org.patch",
                                {"title": f"LOADTEST Ideathon {self.stamp}"}, self.org)
        start = datetime.now(timezone.utc) + timedelta(days=1)
        await self.api.call("POST", f"/organizer/api/v1/hackathons/{self.hid}/timeline/materialize", "org.timeline", {
            "eventStart": start.isoformat().replace("+00:00", "Z"),
            "eventEnd": (start + timedelta(days=2)).isoformat().replace("+00:00", "Z"),
        }, self.org)
        for step in ("review", "confirm", "publish"):
            status, body = await self.api.call("POST", f"/organizer/api/v1/hackathons/{self.hid}/{step}", f"org.{step}", {}, self.org)
            if status not in (200, 201):
                raise RuntimeError(f"{step} failed {status} {body}")
        await self.set_round(1)
        self.log(f"hackathon {self.hid} published (title={hackathon.get('title')})")

    async def set_round(self, number):
        status, body = await self.api.call("GET", f"/organizer/api/v1/hackathons/{self.hid}/ideation", "org.ideation.get", token=self.org)
        config = self.api.data(body)
        config["currentRound"] = number
        status, body = await self.api.call("PUT", f"/organizer/api/v1/hackathons/{self.hid}/ideation", "org.ideation.put", config, self.org)
        self.log(f"round -> {number}: {status}")

    async def onboard(self, user, delay):
        await asyncio.sleep(delay)
        status, body = await self.api.call("POST", "/api/v1/auth/register", "auth.register", {
            "fullName": f"Load User {user.index}", "email": user.email, "password": PASSWORD, "phoneNumber": user.phone,
        })
        if status not in (200, 201):
            return
        user.token, user.refresh_token, user.token_at = body["accessToken"], body["refreshToken"], time.time()
        await self.api.call("PUT", "/api/v1/skill-profile", "skill-profile", {
            "programmingLanguages": ["Python"], "frameworks": ["React"], "experienceLevel": "INTERMEDIATE",
        }, user.token)
        if user.index == 0:
            await self.api.call("POST", "/api/v1/sync/pull", "sync.pull", {}, user.token)
        await self.api.call("GET", "/api/v1/hackathons", "hackathons.list", token=user.token)
        status, _ = await self.api.call("POST", f"/api/v1/hackathons/{self.hid}/register", "hackathon.register",
                                        {"teamChoice": "later", "eligibilityAccepted": True}, user.token)
        user.registered = status in (200, 201)

    async def registration_burst(self):
        self.recorder.phase = "a_reg"
        await self.onboard(self.users[0], 0)
        await asyncio.gather(*(self.onboard(u, random.uniform(0, REG_WINDOW)) for u in self.users[1:]))
        ok = sum(u.registered for u in self.users)
        self.log(f"registration burst done: {ok}/{USERS} registered")

    async def team_formation(self):
        self.recorder.phase = "b_team"
        ready = [u for u in self.users if u.registered]
        status, body = await self.api.call("GET", f"/api/v1/hackathons/{self.hid}", "hackathon.get", token=ready[0].token)
        cap = (self.api.data(body) or {}).get("teamSize", {}) or {}
        size = min(5, cap.get("max") or 5)
        leaders, joiners = ready[:TEAMS], ready[TEAMS:TEAMS + JOINERS]

        async def create(leader, i):
            status, body = await self.api.call("POST", "/api/v1/team", "team.create",
                                               {"name": f"LOADTEST Team {self.stamp}-{i}", "hackathonId": self.hid, "maxMembers": size}, leader.token)
            if status in (200, 201):
                leader.team = self.api.data(body)
                self.teams.append(leader.team)

        await asyncio.gather(*(create(u, i) for i, u in enumerate(leaders)))
        full = defaultdict(int)

        async def join(user, team):
            await asyncio.sleep(random.uniform(0, 5))
            status, body = await self.api.call("POST", "/api/v1/team/join-by-code", "team.join",
                                               {"teamName": team["name"], "tid": team["inviteCode"], "hackathonId": self.hid}, user.token)
            if status in (200, 201):
                user.team = team
            elif "full" in str(body).lower():
                full[team["id"]] += 1

        await asyncio.gather(*(join(u, self.teams[i % len(self.teams)]) for i, u in enumerate(joiners)))
        joined = sum(1 for u in joiners if u.team)
        self.log(f"teams created {len(self.teams)}/{TEAMS} size={size}; joined {joined}/{len(joiners)}; "
                 f"'Team is full' rejections {sum(full.values())} across {len(full)} teams")

    async def ensure_token(self, user):
        if time.time() - user.token_at < 720:
            return
        status, body = await self.api.call("POST", "/api/v1/auth/refresh", "auth.refresh", {"refreshToken": user.refresh_token})
        if status == 200:
            user.token, user.refresh_token, user.token_at = body["accessToken"], body["refreshToken"], time.time()

    async def send_message(self, user, label="ideation.send"):
        scope = "team" if user.team and random.random() < 0.5 else "personal"
        status, _ = await self.api.call("POST", f"/api/v1/ideation/{self.hid}/messages", f"{label}.{scope}",
                                        {"scope": scope, "content": f"Idea note from user {user.index} at {time.time():.0f}"}, user.token)
        if status == 200:
            user.sent[scope] += 1

    async def every(self, user, period, action):
        await asyncio.sleep(random.uniform(0, period))
        while not self.stop.is_set():
            await self.ensure_token(user)
            await action()
            await asyncio.sleep(period * random.uniform(0.9, 1.1))

    async def participant(self, user):
        pages = [
            ("GET", "/api/v1/auth/me", "auth.me"),
            ("GET", f"/api/v1/team/me?hackathonId={self.hid}", "team.me"),
            ("GET", "/api/v1/hackathons", "hackathons.list"),
            ("GET", f"/api/v1/hackathons/{self.hid}", "hackathon.get"),
        ]

        async def poll():
            await self.api.call("GET", f"/api/v1/ideation/{self.hid}", "ideation.poll", token=user.token)

        async def unread():
            await self.api.call("GET", "/api/v1/notifications/unread-count", "notif.unread", token=user.token)

        async def page():
            method, path, name = random.choice(pages)
            await self.api.call(method, path, name, token=user.token)

        async def chat():
            await asyncio.sleep(random.uniform(0, 30))
            await self.send_message(user)

        await asyncio.gather(
            self.every(user, 15, poll), self.every(user, 30, unread),
            self.every(user, 90, page), self.every(user, 150, chat),
        )

    async def lag_probe(self):
        while not self.stop.is_set():
            await self.api.call("GET", "/api/v1/health", "probe.health")
            await asyncio.sleep(0.25)

    async def restart_container(self):
        await asyncio.sleep(RESTART_AT)
        self.recorder.phase = "e_restart"
        self.log(f"restarting {CONTAINER}")
        connector = aiohttp.UnixConnector(path="/var/run/docker.sock")
        async with aiohttp.ClientSession(connector=connector) as docker:
            async with docker.post(f"http://docker/containers/{CONTAINER}/restart?t=10") as res:
                self.log(f"docker restart returned {res.status}")
        await asyncio.sleep(60)
        self.recorder.phase = "c_steady"

    async def round_spike(self):
        await asyncio.sleep(ROUND_AT)
        self.recorder.phase = "d_spike"
        await self.set_round(2)
        chosen = random.sample([u for u in self.users if u.token], min(SPIKE_USERS, sum(1 for u in self.users if u.token)))

        async def burst(user):
            await asyncio.sleep(random.uniform(0, 30))
            await self.send_message(user, "spike.send")

        await asyncio.gather(*(burst(u) for u in chosen))
        self.log(f"round spike done: {len(chosen)} users")
        self.recorder.phase = "c_steady"

    async def steady_state(self):
        self.recorder.phase = "c_steady"
        active = [u for u in self.users if u.registered]
        self.log(f"steady state for {STEADY:.0f}s with {len(active)} users")
        workers = [asyncio.create_task(self.participant(u)) for u in active]
        side = [asyncio.create_task(self.lag_probe())]
        timed = [asyncio.create_task(job()) for at, job in ((RESTART_AT, self.restart_container), (ROUND_AT, self.round_spike)) if at < STEADY]
        await asyncio.sleep(STEADY)
        self.stop.set()
        await asyncio.gather(*timed, return_exceptions=True)
        for task in workers + side:
            task.cancel()
        await asyncio.gather(*workers, *side, return_exceptions=True)

    async def verify(self):
        self.recorder.phase = "f_verify"
        await asyncio.sleep(5)
        active = [u for u in self.users if u.registered]
        mismatched, teamless = [], 0
        team_expected = defaultdict(int)
        for u in active:
            if u.team:
                team_expected[u.team["id"]] += u.sent["team"]
        semaphore = asyncio.Semaphore(32)

        async def check(user):
            async with semaphore:
                await self.ensure_token(user)
                status, body = await self.api.call("GET", f"/api/v1/ideation/{self.hid}", "verify.ideation", token=user.token)
                view = self.api.data(body) if status == 200 else {}
                personal = len(view.get("personalThread") or [])
                team_view = view.get("team") or {}
                team_len = len(view.get("teamThread") or []) if view.get("teamThread") is not None else None
                return user, status, personal, team_view.get("id"), team_len

        results = await asyncio.gather(*(check(u) for u in active))
        team_seen = {}
        for user, status, personal, team_id, team_len in results:
            if status != 200 or personal < user.sent["personal"]:
                mismatched.append((user.index, status, personal, user.sent["personal"]))
            if user.team and team_id != user.team["id"]:
                teamless += 1
            if team_id:
                team_seen[team_id] = team_len
        team_short = {tid: (team_seen.get(tid), n) for tid, n in team_expected.items() if (team_seen.get(tid) or 0) < n}
        totals = {s: sum(u.sent[s] for u in active) for s in ("personal", "team")}
        self.log(f"verify: users={len(active)} personal-thread mismatches={len(mismatched)} {mismatched[:5]}; "
                 f"membership lost={teamless}; team threads short={len(team_short)} {list(team_short.items())[:5]}; "
                 f"sent ok personal={totals['personal']} team={totals['team']}")
        os.makedirs(OUT, exist_ok=True)
        with open(os.path.join(OUT, "expected.json"), "w") as fh:
            json.dump({
                "stamp": self.stamp, "hid": self.hid, "users": len(active), "teams": len(self.teams),
                "members": sum(1 for u in active if u.team),
                "messages": totals, "org_email": f"org-{self.stamp}@load.hmt",
            }, fh)

    async def run(self):
        connector = aiohttp.TCPConnector(limit=0, ttl_dns_cache=300)
        timeout = aiohttp.ClientTimeout(total=60)
        async with aiohttp.ClientSession(connector=connector, timeout=timeout) as session:
            self.api = Api(session, self.recorder)
            await self.organizer_setup()
            await self.registration_burst()
            await self.team_formation()
            await self.steady_state()
            await self.verify()
        self.recorder.save()
        report = self.recorder.summary()
        print(report, flush=True)
        with open(os.path.join(OUT, "summary.txt"), "w") as fh:
            fh.write("\n".join(self.events) + "\n\n" + report + "\n")


if __name__ == "__main__":
    asyncio.run(LoadTest().run())
