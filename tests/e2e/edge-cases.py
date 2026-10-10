#!/usr/bin/env python3
import argparse
import base64
import hashlib
import hmac
import json
import random
import string
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

DEV_SYNC_SECRET = "hmt-dev-sync-secret-change-in-production"


class Response:
    def __init__(self, status, text, headers):
        self.status = status
        self.text = text
        self.headers = headers
        try:
            self.body = json.loads(text) if text else None
        except ValueError:
            self.body = None

    def field(self, *path):
        node = self.body
        for key in path:
            if isinstance(node, dict):
                node = node.get(key)
            elif isinstance(node, list) and isinstance(key, int) and key < len(node):
                node = node[key]
            else:
                return None
        return node

    def message(self):
        if isinstance(self.body, dict):
            error = self.body.get("error")
            if isinstance(error, dict) and error.get("message"):
                return str(error["message"])
            if self.body.get("message"):
                return str(self.body["message"])
        return self.text[:200]

    def __repr__(self):
        return f"<{self.status} {self.text[:300]!r}>"


class Report:
    def __init__(self):
        self.lock = threading.Lock()
        self.passed = 0
        self.failed = []
        self.skipped = 0

    def check(self, name, ok, detail=""):
        with self.lock:
            if ok:
                self.passed += 1
                print(f"PASS {name}", flush=True)
            else:
                self.failed.append(name)
                print(f"FAIL {name} {detail}", flush=True)
        return ok

    def expect(self, name, response, statuses, predicate=None):
        allowed = statuses if isinstance(statuses, (list, tuple, set)) else [statuses]
        ok = response.status in allowed
        if ok and predicate is not None:
            try:
                ok = bool(predicate(response))
            except Exception as error:
                ok = False
                return self.check(name, False, f"predicate raised {error!r}; got {response!r}")
        return self.check(name, ok, f"expected {list(allowed)}; got {response!r}")

    def skip(self, name, reason):
        with self.lock:
            self.skipped += 1
            print(f"SKIP {name} ({reason})", flush=True)

    def server_error(self, method, url, response):
        self.check(f"no-500 {method} {url}", False, repr(response))


class Http:
    def __init__(self, base, origin, report):
        self.base = base.rstrip("/")
        self.origin = origin
        self.report = report

    def build(self, method, path, body, token, headers, raw):
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        request = urllib.request.Request(self.base + path, data=data, method=method)
        if data is not None:
            request.add_header("Content-Type", "application/json")
        if self.origin:
            request.add_header("Origin", self.origin)
        if token:
            request.add_header("Authorization", f"Bearer {token}")
        for key, value in (headers or {}).items():
            request.add_header(key, value)
        return request

    def call(self, method, path, body=None, token=None, headers=None, raw=None, timeout=60):
        for attempt in range(15):
            request = self.build(method, path, body, token, headers, raw)
            try:
                with urllib.request.urlopen(request, timeout=timeout) as handle:
                    response = Response(handle.status, handle.read().decode("utf-8", "replace"), dict(handle.headers))
            except urllib.error.HTTPError as error:
                response = Response(error.code, error.read().decode("utf-8", "replace"), dict(error.headers or {}))
            except (urllib.error.URLError, ConnectionError, TimeoutError) as error:
                response = Response(0, f"connection error: {error}", {})
            if response.status == 429 and attempt < 14:
                time.sleep(float(response.headers.get("Retry-After") or 5))
                continue
            break
        if response.status >= 500:
            self.report.server_error(method, self.base + path, response)
        return response

    def stream(self, path, body, token, on_event=None, timeout=180):
        request = self.build("POST", path, body, token, None, None)
        events = []
        try:
            with urllib.request.urlopen(request, timeout=timeout) as handle:
                status = handle.status
                event_name = None
                for raw_line in handle:
                    line = raw_line.decode("utf-8", "replace").rstrip("\r\n")
                    if line.startswith("event: "):
                        event_name = line[7:]
                    elif line.startswith("data: "):
                        payload = json.loads(line[6:])
                        events.append((event_name, payload))
                        if on_event:
                            on_event(event_name, payload)
        except urllib.error.HTTPError as error:
            response = Response(error.code, error.read().decode("utf-8", "replace"), {})
            if response.status >= 500:
                self.report.server_error("POST", self.base + path, response)
            return response, events
        return Response(status, "", {}), events


class Clock:
    @staticmethod
    def iso(delta):
        return (datetime.now(timezone.utc) + delta).strftime("%Y-%m-%dT%H:%M:%S.000Z")


class Ideation:
    @staticmethod
    def config(current_round=1, rounds=5, questions=2, title=None):
        return {
            "currentRound": current_round,
            "rounds": [
                {
                    "title": title if title is not None else f"Round {index + 1}",
                    "goal": f"Goal for round {index + 1}",
                    "questions": [f"Question {q + 1}?" for q in range(questions)],
                    "exitCriteria": f"Exit criteria {index + 1}",
                }
                for index in range(rounds)
            ],
            "extraInstructions": "Be brief.",
        }


class Participant:
    def __init__(self, data, email, phone, password):
        self.token = data.get("accessToken")
        self.refresh = data.get("refreshToken")
        self.id = (data.get("user") or {}).get("id")
        self.email = email
        self.phone = phone
        self.password = password


class EdgeCaseSuite:
    def __init__(self, args):
        self.report = Report()
        self.p = Http(args.participant, args.origin, self.report)
        self.o = Http(args.organizer, args.origin, self.report)
        self.sync_secret = args.sync_secret
        self.ai = not args.no_ai
        self.run = "".join(random.choices(string.ascii_lowercase + string.digits, k=6))
        self.counter = 0
        self.counter_lock = threading.Lock()

    def unique(self, prefix):
        with self.counter_lock:
            self.counter += 1
            return f"{prefix}{self.run}{self.counter}"

    @staticmethod
    def phone():
        return "+91" + random.choice("6789") + "".join(random.choices(string.digits, k=9))

    @staticmethod
    def token_of(body):
        if not isinstance(body, dict):
            return None
        for node in (body, body.get("data") or {}, body.get("tokens") or {}, (body.get("data") or {}).get("tokens") or {}):
            if isinstance(node, dict) and node.get("accessToken"):
                return node["accessToken"]
        return None

    def organizer(self, label):
        email = f"{self.unique(label)}@edge.test"
        response = self.o.call("POST", "/auth/register", {
            "email": email,
            "password": "Org4nizer!Pass",
            "fullName": f"Edge {label}",
            "phoneNumber": self.phone(),
            "role": "ORGANIZER",
        })
        token = self.token_of(response.body)
        if not token:
            raise SystemExit(f"cannot register organizer: {response!r}")
        return token

    def participant(self, name=None, profile=True):
        email = f"{self.unique('p')}@edge.test"
        phone = self.phone()
        password = "Particip4nt!Pass"
        response = self.p.call("POST", "/auth/register", {
            "email": email, "password": password, "fullName": name or f"Edge {email[:8]}", "phoneNumber": phone,
        })
        if response.status != 201:
            raise SystemExit(f"cannot register participant: {response!r}")
        user = Participant(response.body, email, phone, password)
        if profile:
            self.p.call("PUT", "/skill-profile", {"programmingLanguages": ["Python"], "experienceLevel": "INTERMEDIATE"}, token=user.token)
        return user

    def participants(self, count, register_for=None):
        users = [None] * count

        def make(index):
            users[index] = self.participant()
            if register_for:
                self.register(users[index], register_for)

        threads = [threading.Thread(target=make, args=(i,)) for i in range(count)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        return users

    def register(self, user, hackathon_id, body=None):
        return self.p.call("POST", f"/hackathons/{hackathon_id}/register", body if body is not None else {"eligibilityAccepted": True}, token=user.token)

    def publish_flow(self, token, hackathon_id):
        for step in ("review", "confirm", "publish"):
            response = self.o.call("POST", f"/hackathons/{hackathon_id}/{step}", {}, token=token)
            if response.status != 200:
                raise SystemExit(f"cannot {step} {hackathon_id}: {response!r}")

    def wait_visible(self, token, hackathon_id, predicate=lambda r: True, seconds=15):
        deadline = time.time() + seconds
        pulled = False
        while time.time() < deadline:
            response = self.p.call("GET", f"/hackathons/{hackathon_id}", token=token)
            if response.status == 200 and predicate(response):
                return response
            if not pulled and time.time() > deadline - seconds / 2:
                self.p.call("POST", "/sync/pull", {"limit": 200}, token=token)
                pulled = True
            time.sleep(0.4)
        return self.p.call("GET", f"/hackathons/{hackathon_id}", token=token)

    def manual_hackathon(self, token, title, reg_start, reg_end, evt_start, evt_end, criteria=True, publish=True, eligibility=None):
        response = self.o.call("POST", "/hackathons", {
            "title": title,
            "description": f"{title} description",
            "hackathonType": "OPEN_INNOVATION",
            "mode": "ONLINE",
            "registrationStart": reg_start,
            "registrationEnd": reg_end,
            "eventStart": evt_start,
            "eventEnd": evt_end,
            "eligibility": eligibility or [],
            "teamSize": {"min": 1, "max": 4},
        }, token=token)
        if response.status != 201:
            raise SystemExit(f"cannot create manual hackathon: {response!r}")
        hackathon_id = response.field("data", "id")
        self.o.call("POST", f"/hackathons/{hackathon_id}/phases", {"name": "registration", "order": 1, "startsAt": reg_start, "endsAt": reg_end}, token=token)
        if criteria:
            self.o.call("POST", f"/hackathons/{hackathon_id}/evaluation-criteria", {"name": "Impact", "weight": 1, "maxScore": 10}, token=token)
        if publish:
            self.publish_flow(token, hackathon_id)
        return hackathon_id

    def seed(self):
        self.org = self.organizer("orga")
        self.org_other = self.organizer("orgb")
        response = self.o.call("POST", "/hackathons/wizard/generate", {
            "mode": "ONLINE",
            "about": "Edge case test hackathon about civic tech for students",
            "hackathonType": "OPEN_INNOVATION",
            "eligibility": ["Students"],
            "durationPlus": "48 hours, teams of 2-4",
        }, token=self.org, timeout=120)
        if response.status != 201:
            raise SystemExit(f"wizard failed: {response!r}")
        self.h1 = response.field("data", "hackathon", "id")
        response = self.o.call("POST", f"/hackathons/{self.h1}/timeline/materialize", {
            "eventStart": Clock.iso(timedelta(hours=-1)),
            "eventEnd": Clock.iso(timedelta(days=4)),
        }, token=self.org)
        if response.status != 201:
            raise SystemExit(f"materialize failed: {response!r}")
        self.publish_flow(self.org, self.h1)
        past, future = timedelta(days=-3), timedelta(days=3)
        self.h2 = self.manual_hackathon(self.org, f"Closed {self.run}", Clock.iso(past), Clock.iso(timedelta(days=-2)), Clock.iso(past), Clock.iso(future))
        self.h3 = self.manual_hackathon(self.org, f"Secondary {self.run}", Clock.iso(timedelta(days=-1)), Clock.iso(timedelta(days=2)), Clock.iso(timedelta(days=-1)), Clock.iso(future))
        self.watcher = self.participant()
        for hackathon_id in (self.h1, self.h2, self.h3):
            response = self.wait_visible(self.watcher.token, hackathon_id)
            if response.status != 200:
                raise SystemExit(f"hackathon {hackathon_id} never reached participant API: {response!r}")
        self.h1_detail = self.p.call("GET", f"/hackathons/{self.h1}", token=self.watcher.token).body
        print(f"seeded h1={self.h1} h2={self.h2} h3={self.h3} derived={self.h1_detail.get('derivedStatus')} teamSize={self.h1_detail.get('teamSize')}", flush=True)

    def forged_jwt(self, exp_offset):
        def b64(data):
            return base64.urlsafe_b64encode(json.dumps(data).encode()).rstrip(b"=").decode()
        head = b64({"alg": "HS256", "typ": "JWT"})
        body = b64({"sub": "user_x", "role": "PARTICIPANT", "type": "access", "iss": "hmt", "aud": "hmt:api", "exp": int(time.time()) + exp_offset, "iat": int(time.time()) - 3600})
        signature = base64.urlsafe_b64encode(hmac.new(b"not-the-secret", f"{head}.{body}".encode(), hashlib.sha256).digest()).rstrip(b"=").decode()
        return f"{head}.{body}.{signature}"

    def auth_cases(self):
        r = self.report
        base = self.participant()
        r.expect("auth: duplicate email 409", self.p.call("POST", "/auth/register", {"email": base.email, "password": "Another1!pass", "fullName": "Dup", "phoneNumber": self.phone()}), 409)
        r.expect("auth: duplicate email different case 409", self.p.call("POST", "/auth/register", {"email": base.email.upper(), "password": "Another1!pass", "fullName": "Dup", "phoneNumber": self.phone()}), 409)
        r.expect("auth: duplicate phone 409", self.p.call("POST", "/auth/register", {"email": f"{self.unique('d')}@edge.test", "password": "Another1!pass", "fullName": "Dup", "phoneNumber": base.phone}), 409)
        r.expect("auth: weak password 400", self.p.call("POST", "/auth/register", {"email": f"{self.unique('w')}@edge.test", "password": "short", "fullName": "Weak", "phoneNumber": self.phone()}), 400)
        r.expect("auth: oversized password 400", self.p.call("POST", "/auth/register", {"email": f"{self.unique('w')}@edge.test", "password": "A1!" + "x" * 300, "fullName": "Long", "phoneNumber": self.phone()}), 400)
        for label, phone in (("no plus", "919876543210"), ("letters", "+91abc"), ("spaces", "+91 98765 43210"), ("too short", "+9112")):
            r.expect(f"auth: invalid phone ({label}) 400", self.p.call("POST", "/auth/register", {"email": f"{self.unique('ph')}@edge.test", "password": "Valid1!pass", "fullName": "Phone", "phoneNumber": phone}), 400)
        r.expect("auth: invalid email 400", self.p.call("POST", "/auth/register", {"email": "not-an-email", "password": "Valid1!pass", "fullName": "Mail", "phoneNumber": self.phone()}), 400)
        r.expect("auth: missing fullName 400", self.p.call("POST", "/auth/register", {"email": f"{self.unique('n')}@edge.test", "password": "Valid1!pass", "phoneNumber": self.phone()}), 400)
        r.expect("auth: whitespace fullName 400", self.p.call("POST", "/auth/register", {"email": f"{self.unique('n')}@edge.test", "password": "Valid1!pass", "fullName": "   ", "phoneNumber": self.phone()}), 400)
        r.expect("auth: 10k-char fullName 400", self.p.call("POST", "/auth/register", {"email": f"{self.unique('n')}@edge.test", "password": "Valid1!pass", "fullName": "N" * 10000, "phoneNumber": self.phone()}), 400)
        for label, name in (("html", "<script>alert(1)</script><img src=x onerror=alert(2)>"), ("emoji", "Zoë 🚀🔥 Ñandú"), ("unicode", "名前 テスト Ελληνικά العربية"), ("160 chars", "é" * 160)):
            response = self.p.call("POST", "/auth/register", {"email": f"{self.unique('u')}@edge.test", "password": "Valid1!pass", "fullName": name, "phoneNumber": self.phone()})
            r.expect(f"auth: fullName {label} stored verbatim", response, 201, lambda x, n=name: x.field("user", "fullName") == n)
            if response.status == 201:
                me = self.p.call("GET", "/auth/me", token=response.body["accessToken"])
                r.expect(f"auth: /me returns {label} name verbatim", me, 200, lambda x, n=name: x.field("fullName") == n)
        wrong = self.p.call("POST", "/auth/login", {"email": base.email, "password": "Wrong1!password"})
        unknown = self.p.call("POST", "/auth/login", {"email": f"{self.unique('nobody')}@edge.test", "password": "Wrong1!password"})
        r.expect("auth: login wrong password 401", wrong, 401)
        r.expect("auth: login unknown email 401", unknown, 401)
        r.check("auth: wrong password and unknown email share one generic error", wrong.message() == unknown.message(), f"{wrong.message()!r} vs {unknown.message()!r}")
        r.expect("auth: login with different email case 200", self.p.call("POST", "/auth/login", {"email": base.email.upper(), "password": base.password}), 200)
        r.expect("auth: refresh garbage token 401", self.p.call("POST", "/auth/refresh", {"refreshToken": "garbage-token"}), 401)
        r.expect("auth: refresh missing token 400", self.p.call("POST", "/auth/refresh", {}), 400)
        first = self.p.call("POST", "/auth/refresh", {"refreshToken": base.refresh})
        r.expect("auth: refresh rotates token 200", first, 200, lambda x: x.field("refreshToken") and x.field("refreshToken") != base.refresh)
        tabs = self.p.call("POST", "/auth/login", {"email": base.email, "password": base.password}).body["refreshToken"]
        pair = [None, None]
        workers = [threading.Thread(target=lambda i=i: pair.__setitem__(i, self.p.call("POST", "/auth/refresh", {"refreshToken": tabs}))) for i in range(2)]
        for worker in workers:
            worker.start()
        for worker in workers:
            worker.join()
        r.check("auth: two tabs refreshing the same token concurrently both succeed", all(x.status == 200 for x in pair), f"{pair!r}")
        if all(x.status == 200 for x in pair):
            r.expect("auth: session survives concurrent refresh", self.p.call("POST", "/auth/refresh", {"refreshToken": pair[0].body["refreshToken"]}), 200)
        time.sleep(11)
        r.expect("auth: reusing rotated refresh token after grace window 401", self.p.call("POST", "/auth/refresh", {"refreshToken": base.refresh}), 401)
        if first.status == 200:
            r.expect("auth: reuse detection revokes whole family 401", self.p.call("POST", "/auth/refresh", {"refreshToken": first.body["refreshToken"]}), 401)
        r.expect("auth: /me without token 401", self.p.call("GET", "/auth/me"), 401)
        r.expect("auth: /me garbage bearer 401", self.p.call("GET", "/auth/me", token="garbage"), 401)
        r.expect("auth: /me expired forged token 401", self.p.call("GET", "/auth/me", token=self.forged_jwt(-60)), 401)
        r.expect("auth: /me forged signature 401", self.p.call("GET", "/auth/me", token=self.forged_jwt(3600)), 401)
        session = self.p.call("POST", "/auth/login", {"email": base.email, "password": base.password})
        if session.status == 200:
            r.expect("auth: logout 200", self.p.call("POST", "/auth/logout", {"refreshToken": session.body["refreshToken"]}, token=session.body["accessToken"]), 200)
            r.expect("auth: refresh after logout 401", self.p.call("POST", "/auth/refresh", {"refreshToken": session.body["refreshToken"]}), 401)
        email = f"{self.unique('race')}@edge.test"
        results = []

        def signup():
            results.append(self.p.call("POST", "/auth/register", {"email": email, "password": "Valid1!pass", "fullName": "Race", "phoneNumber": self.phone()}).status)

        threads = [threading.Thread(target=signup) for _ in range(5)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        r.check("auth: 5 concurrent signups same email -> exactly one 201", results.count(201) == 1 and results.count(409) == 4, f"statuses={sorted(results)}")

    def registration_cases(self):
        r = self.report
        user = self.participant()
        first = self.register(user, self.h1)
        r.expect("reg: register 201", first, (200, 201), lambda x: x.field("hackathonId") == self.h1)
        second = self.register(user, self.h1)
        r.expect("reg: register twice idempotent (same record)", second, (200, 201), lambda x: x.field("id") == first.field("id"))
        mine = self.p.call("GET", "/hackathons/registrations/me", token=user.token)
        r.expect("reg: no duplicate registration rows", mine, 200, lambda x: len([g for g in x.body if g["hackathonId"] == self.h1]) == 1)
        racer = self.participant()
        statuses = []
        threads = [threading.Thread(target=lambda: statuses.append(self.register(racer, self.h1).status)) for _ in range(6)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        rows = self.p.call("GET", "/hackathons/registrations/me", token=racer.token)
        r.check("reg: 6 concurrent registers -> one row", all(s in (200, 201) for s in statuses) and len([g for g in rows.body or [] if g["hackathonId"] == self.h1]) == 1, f"statuses={statuses} rows={rows!r}")
        r.expect("reg: unknown hackathon 404", self.register(user, "hack_does_not_exist"), 404)
        draft_id = self.manual_hackathon(self.org, f"Draft {self.run}", Clock.iso(timedelta(days=-1)), Clock.iso(timedelta(days=2)), Clock.iso(timedelta(days=-1)), Clock.iso(timedelta(days=3)), publish=False)
        r.expect("reg: DRAFT hackathon 404", self.register(user, draft_id), 404)
        r.expect("reg: DRAFT hackathon detail 404", self.p.call("GET", f"/hackathons/{draft_id}", token=user.token), 404)
        fresh = self.participant()
        if self.h1_detail.get("eligibility"):
            r.expect("reg: eligibility not accepted 400", self.register(fresh, self.h1, {}), 400)
            r.expect("reg: eligibility false 400", self.register(fresh, self.h1, {"eligibilityAccepted": False}), 400)
        else:
            r.skip("reg: eligibility required", "h1 has no eligibility on participant side")
        r.expect("reg: invalid teamChoice 400", self.register(fresh, self.h1, {"eligibilityAccepted": True, "teamChoice": "steal"}), 400)
        r.expect("reg: foreign teamId 400", self.register(fresh, self.h1, {"eligibilityAccepted": True, "teamId": "team_nope"}), 400)
        r.expect("reg: without skill profile 400", self.register(self.participant(profile=False), self.h1), 400)
        late = self.participant()
        r.expect("reg: after registration window closed 400", self.register(late, self.h2), 400)
        my = self.p.call("GET", "/hackathons/my", token=user.token)
        r.expect("reg: list my hackathons contains h1", my, 200, lambda x: [h["id"] for h in x.body["data"]].count(self.h1) == 1)
        r.expect("reg: my hackathons excludes closed h2", self.p.call("GET", "/hackathons/my", token=late.token), 200, lambda x: all(h["id"] != self.h2 for h in x.body["data"]))

    def create_team(self, user, hackathon_id, name, max_members=None, **extra):
        body = {"name": name, "hackathonId": hackathon_id, **extra}
        if max_members is not None:
            body["maxMembers"] = max_members
        return self.p.call("POST", "/team", body, token=user.token)

    def join_code(self, user, hackathon_id, team):
        return self.p.call("POST", "/team/join-by-code", {"teamName": team["name"], "tid": team["inviteCode"], "hackathonId": hackathon_id}, token=user.token)

    def team_of(self, user, hackathon_id):
        return self.p.call("GET", f"/team/me?hackathonId={hackathon_id}", token=user.token)

    def team_cases(self):
        r = self.report
        cap = (self.h1_detail.get("teamSize") or {}).get("max")
        outsider = self.participant()
        r.expect("team: create before registering 403", self.create_team(outsider, self.h1, self.unique("T")), 403)
        self.leader, self.mate, self.loner, namer, dup = self.participants(5, register_for=self.h1)
        name = f"Alpha {self.run}"
        created = self.create_team(self.leader, self.h1, name, 3)
        r.expect("team: create 201", created, 201, lambda x: x.field("inviteCode", ))
        self.team_a = created.body
        r.expect("team: second team while in one 400", self.create_team(self.leader, self.h1, self.unique("T")), 400)
        r.expect("team: duplicate name 409", self.create_team(dup, self.h1, name), 409)
        r.expect("team: duplicate name case-insensitive 409", self.create_team(dup, self.h1, name.upper()), 409)
        r.expect("team: duplicate name with padding 409", self.create_team(dup, self.h1, f"  {name.lower()}  "), 409)
        r.expect("team: empty name 400", self.create_team(dup, self.h1, ""), 400)
        r.expect("team: whitespace name 400", self.create_team(dup, self.h1, "    "), 400)
        r.expect("team: 121-char name 400", self.create_team(dup, self.h1, "N" * 121), 400)
        r.expect("team: null name 400", self.create_team(dup, self.h1, None), 400)
        r.expect("team: maxMembers 1 400", self.create_team(dup, self.h1, self.unique("T"), 1), 400)
        r.expect("team: maxMembers 13 400", self.create_team(dup, self.h1, self.unique("T"), 13), 400)
        r.expect("team: maxMembers 2.5 400", self.create_team(dup, self.h1, self.unique("T"), 2.5), 400)
        r.expect("team: maxMembers string 400", self.create_team(dup, self.h1, self.unique("T"), "abc"), 400)
        if isinstance(cap, int) and cap + 1 <= 12:
            r.expect(f"team: maxMembers above hackathon cap {cap} 400", self.create_team(dup, self.h1, self.unique("T"), cap + 1), 400)
        else:
            r.skip("team: maxMembers above hackathon cap", f"cap={cap}")
        r.expect("team: unknown field rejected 400", self.create_team(dup, self.h1, self.unique("T"), inviteCode="HMT-AAAAAA"), 400)
        html = "<b onmouseover=alert(1)>Team</b> 🚀 " + self.run
        made = self.create_team(namer, self.h1, html, 2)
        r.expect("team: HTML/emoji name stored verbatim", made, 201, lambda x: x.field("name") == html)
        r.expect("team: sole leader leaving removes empty team", self.p.call("POST", f"/team/leave?teamId={made.field('id')}", token=namer.token), (200, 201), lambda x: "removed" in x.message())
        r.expect("team: join own team 400", self.join_code(self.leader, self.h1, self.team_a), 400)
        r.expect("team: wrong code 404", self.join_code(dup, self.h1, {**self.team_a, "inviteCode": "HMT-ZZZZZZ"}), 404)
        r.expect("team: wrong name + right code 404", self.join_code(dup, self.h1, {**self.team_a, "name": "Not The Name"}), 404)
        r.expect("team: lowercase code + padded name accepted", self.join_code(self.mate, self.h1, {"name": f"  {name.upper()} ", "inviteCode": self.team_a["inviteCode"].lower()}), (200, 201))
        h3_leader = self.participant()
        self.register(h3_leader, self.h3)
        self.team_h3 = self.create_team(h3_leader, self.h3, f"Gamma {self.run}").body
        self.h3_leader = h3_leader
        r.expect("team: code from another hackathon 404", self.join_code(dup, self.h1, self.team_h3), 404)
        r.expect("team: code for hackathon not registered 403", self.join_code(dup, self.h3, self.team_h3), 403)
        non_member = self.p.call("GET", f"/team/{self.team_a['id']}", token=self.loner.token)
        r.expect("team: GET team as registered non-member hides inviteCode", non_member, 200, lambda x: "inviteCode" not in x.body and "members" not in x.body)
        r.expect("team: GET team as unregistered user hides inviteCode", self.p.call("GET", f"/team/{self.team_a['id']}", token=outsider.token), 200, lambda x: "inviteCode" not in x.body)
        r.expect("team: GET team as member shows inviteCode", self.p.call("GET", f"/team/{self.team_a['id']}", token=self.leader.token), 200, lambda x: x.field("inviteCode") == self.team_a["inviteCode"])
        r.expect("team: GET unknown team 404", self.p.call("GET", "/team/team_nope", token=self.leader.token), 404)
        capt, *pool = self.participants(11, register_for=self.h1)
        slot_team = self.create_team(capt, self.h1, f"Slot {self.run}", 2).body
        outcomes = [None] * 10
        barrier = threading.Barrier(10)

        def race(index):
            barrier.wait()
            outcomes[index] = self.join_code(pool[index], self.h1, slot_team)

        threads = [threading.Thread(target=race, args=(i,)) for i in range(10)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        winners = [i for i, o in enumerate(outcomes) if o.status in (200, 201)]
        losers = [o.status for o in outcomes if o.status not in (200, 201)]
        r.check("team: 10 concurrent joins for 1 slot -> exactly 1 joins", len(winners) == 1 and all(s == 400 for s in losers), f"statuses={[o.status for o in outcomes]}")
        roster = self.p.call("GET", f"/team/{slot_team['id']}", token=capt.token)
        r.expect("team: full team has exactly maxMembers members", roster, 200, lambda x: len(x.body["members"]) == 2)
        late_joiner = next(p for i, p in enumerate(pool) if i not in winners)
        r.expect("team: join full team 400", self.join_code(late_joiner, self.h1, slot_team), 400, lambda x: "full" in x.message().lower())
        if winners:
            winner = pool[winners[0]]
            r.expect("team: leader leaves while members remain 400", self.p.call("POST", f"/team/leave?teamId={slot_team['id']}", token=capt.token), 400)
            leave = self.p.call("POST", f"/team/leave?teamId={slot_team['id']}", token=winner.token)
            r.expect("team: member leave creates pending request", leave, (200, 201), lambda x: x.field("status") == "PENDING")
            r.expect("team: duplicate leave request 409", self.p.call("POST", f"/team/leave?teamId={slot_team['id']}", token=winner.token), 409)
            r.expect("team: non-leader cannot approve leave 403", self.p.call("POST", f"/team/leave-requests/{leave.field('id')}/accept", token=winner.token), 403)
            r.expect("team: leader approves leave", self.p.call("POST", f"/team/leave-requests/{leave.field('id')}/accept", token=capt.token), (200, 201), lambda x: x.field("status") == "APPROVED")
            r.expect("team: leaver no longer has team", self.team_of(winner, self.h1), 200, lambda x: x.field("team") is None)
            r.expect("team: approve twice 400", self.p.call("POST", f"/team/leave-requests/{leave.field('id')}/accept", token=capt.token), 400)
        lead, member = self.participants(2, register_for=self.h1)
        transfer_team = self.create_team(lead, self.h1, f"Transfer {self.run}", 3).body
        self.join_code(member, self.h1, transfer_team)
        r.expect("team: transfer to non-member 400", self.p.call("POST", f"/team/{transfer_team['id']}/transfer", {"toUserId": outsider.id}, token=lead.token), 400)
        r.expect("team: transfer to self 400", self.p.call("POST", f"/team/{transfer_team['id']}/transfer", {"toUserId": lead.id}, token=lead.token), 400)
        r.expect("team: non-leader transfer 403", self.p.call("POST", f"/team/{transfer_team['id']}/transfer", {"toUserId": member.id}, token=member.token), 403)
        r.expect("team: leader transfer 200", self.p.call("POST", f"/team/{transfer_team['id']}/transfer", {"toUserId": member.id}, token=lead.token), (200, 201))
        r.expect("team: ex-leader cannot delete 403", self.p.call("DELETE", f"/team/{transfer_team['id']}", token=lead.token), 403)
        r.expect("team: new leader deletes team 200", self.p.call("DELETE", f"/team/{transfer_team['id']}", token=member.token), 200)
        r.expect("team: deleted team 404", self.p.call("GET", f"/team/{transfer_team['id']}", token=member.token), 404)
        r.expect("team: former members teamless after delete", self.team_of(lead, self.h1), 200, lambda x: x.field("team") is None)
        racer, other_lead_a, other_lead_b = self.participants(3, register_for=self.h1)
        team_x = self.create_team(other_lead_a, self.h1, f"Xray {self.run}", 4).body
        team_y = self.create_team(other_lead_b, self.h1, f"Yank {self.run}", 4).body
        both = [None, None]
        gate = threading.Barrier(2)

        def double(index, team):
            gate.wait()
            both[index] = self.join_code(racer, self.h1, team)

        pair = [threading.Thread(target=double, args=(0, team_x)), threading.Thread(target=double, args=(1, team_y))]
        for thread in pair:
            thread.start()
        for thread in pair:
            thread.join()
        r.check("team: same user joining two teams concurrently -> exactly one", sorted(o.status for o in both) in ([200, 400], [201, 400]), f"statuses={[o.status for o in both]}")
        first_namer, second_namer = self.participants(2, register_for=self.h1)
        same = f"Twin {self.run}"
        named = [None, None]
        gate2 = threading.Barrier(2)

        def same_name(index, user):
            gate2.wait()
            named[index] = self.create_team(user, self.h1, same, 2)

        pair = [threading.Thread(target=same_name, args=(0, first_namer)), threading.Thread(target=same_name, args=(1, second_namer))]
        for thread in pair:
            thread.start()
        for thread in pair:
            thread.join()
        r.check("team: concurrent creates with same name -> one 201, one 409", sorted(o.status for o in named) == [201, 409], f"statuses={[o.status for o in named]}")
        r.expect("team: join-by-code missing fields 400", self.p.call("POST", "/team/join-by-code", {"tid": "HMT-AAAAAA"}, token=dup.token), 400)

    def stream_message(self, user, hackathon_id, scope, content, on_event=None):
        return self.p.stream(f"/ideation/{hackathon_id}/messages", {"scope": scope, "content": content}, user.token, on_event)

    def put_ideation(self, token, hackathon_id, config):
        return self.o.call("PUT", f"/hackathons/{hackathon_id}/ideation", config, token=token)

    def wait_round(self, user, hackathon_id, expected, seconds=8):
        deadline = time.time() + seconds
        state = None
        while time.time() < deadline:
            state = self.p.call("GET", f"/ideation/{hackathon_id}", token=user.token)
            if state.status == 200 and state.field("currentRound") == expected:
                return state
            time.sleep(0.4)
        return state

    def ideation_cases(self):
        r = self.report
        outsider = self.participant()
        r.expect("ideation: unregistered GET 403", self.p.call("GET", f"/ideation/{self.h1}", token=outsider.token), 403)
        r.expect("ideation: no token 401", self.p.call("GET", f"/ideation/{self.h1}"), 401)
        state = self.p.call("GET", f"/ideation/{self.h1}", token=self.loner.token)
        r.expect("ideation: registered without team -> team thread null, personal list", state, 200, lambda x: x.field("teamThread") is None and isinstance(x.field("personalThread"), list))
        r.expect("ideation: team member sees team", self.p.call("GET", f"/ideation/{self.h1}", token=self.leader.token), 200, lambda x: x.field("team", "id") == self.team_a["id"] and isinstance(x.field("teamThread"), list))
        path = f"/ideation/{self.h1}/messages"
        r.expect("ideation: team scope without team 403", self.p.call("POST", path, {"scope": "team", "content": "hi"}, token=self.loner.token), 403)
        r.expect("ideation: empty content 400", self.p.call("POST", path, {"scope": "personal", "content": ""}, token=self.leader.token), 400)
        r.expect("ideation: whitespace content 400", self.p.call("POST", path, {"scope": "personal", "content": " \n\t "}, token=self.leader.token), 400)
        r.expect("ideation: 4001 chars 400", self.p.call("POST", path, {"scope": "personal", "content": "a" * 4001}, token=self.leader.token), 400)
        r.expect("ideation: invalid scope 400", self.p.call("POST", path, {"scope": "group", "content": "hi"}, token=self.leader.token), 400)
        r.expect("ideation: missing scope 400", self.p.call("POST", path, {"content": "hi"}, token=self.leader.token), 400)
        r.expect("ideation: null content 400", self.p.call("POST", path, {"scope": "personal", "content": None}, token=self.leader.token), 400)
        r.expect("ideation: unknown field 400", self.p.call("POST", path, {"scope": "personal", "content": "hi", "round": 5}, token=self.leader.token), 400)
        r.expect("ideation: unregistered POST 403", self.p.call("POST", path, {"scope": "personal", "content": "hi"}, token=outsider.token), 403)
        r.expect("ideation: non-existent hackathon GET 404", self.p.call("GET", "/ideation/hack_nope", token=self.leader.token), 404)
        r.expect("ideation: non-existent hackathon POST 404", self.p.call("POST", "/ideation/hack_nope/messages", {"scope": "personal", "content": "hi"}, token=self.leader.token), 404)
        bad = {
            "currentRound 0": Ideation.config(0),
            "currentRound 6": Ideation.config(6),
            "currentRound 2.5": Ideation.config(2.5),
            "currentRound string": {**Ideation.config(), "currentRound": "2"},
            "missing rounds": {"currentRound": 1},
            "4 rounds": Ideation.config(1, rounds=4),
            "6 rounds": Ideation.config(1, rounds=6),
            "questions > 12": Ideation.config(1, questions=13),
            "zero questions": Ideation.config(1, questions=0),
            "title > 120": Ideation.config(1, title="T" * 121),
            "blank title": Ideation.config(1, title="   "),
            "extraInstructions > 4000": {**Ideation.config(), "extraInstructions": "x" * 4001},
        }
        for label, config in bad.items():
            r.expect(f"organizer ideation: {label} 400", self.put_ideation(self.org, self.h1, config), 400)
        r.expect("organizer ideation: malformed JSON 400", self.o.call("PUT", f"/hackathons/{self.h1}/ideation", raw=b'{"currentRound":', token=self.org), 400)
        r.expect("organizer ideation: non-owner 403", self.put_ideation(self.org_other, self.h1, Ideation.config(2)), 403)
        r.expect("organizer ideation: non-owner GET 403", self.o.call("GET", f"/hackathons/{self.h1}/ideation", token=self.org_other), 403)
        r.expect("organizer ideation: participant token 401/403", self.put_ideation(self.leader.token, self.h1, Ideation.config(2)), (401, 403))
        r.expect("organizer ideation: no token 401", self.put_ideation(None, self.h1, Ideation.config(2)), 401)
        r.expect("organizer ideation: unknown hackathon 404", self.put_ideation(self.org, "nope", Ideation.config(2)), 404)
        r.expect("organizer ideation: set round 2", self.put_ideation(self.org, self.h1, Ideation.config(2)), 200, lambda x: x.field("data", "currentRound") == 2)
        r.expect("organizer ideation: GET reflects round 2", self.o.call("GET", f"/hackathons/{self.h1}/ideation", token=self.org), 200, lambda x: x.field("data", "currentRound") == 2)
        r.expect("ideation: participant sees round 2 after advance", self.wait_round(self.leader, self.h1, 2), 200, lambda x: x.field("currentRound") == 2 and x.field("ideation", "rounds", 1, "title") == "Round 2")
        sync = f"/sync/ideation/{self.h1}"
        r.expect("sync ideation: no secret 401", self.p.call("PUT", sync, Ideation.config(4)), (401, 403))
        r.expect("sync ideation: wrong secret 401", self.p.call("PUT", sync, Ideation.config(4), headers={"x-sync-secret": "wrong"}), (401, 403))
        r.expect("sync ideation: participant JWT rejected", self.p.call("PUT", sync, Ideation.config(4), token=self.leader.token), (401, 403))
        r.expect("sync ideation: foreign organizer JWT rejected", self.p.call("PUT", sync, Ideation.config(4), token=self.org_other), (401, 403))
        r.expect("sync consume: foreign organizer JWT cannot forge events", self.p.call("POST", "/sync/consume", {"type": "HackathonArchived", "eventId": "00000000-0000-4000-8000-000000000000", "version": "v1", "occurredAt": Clock.iso(timedelta()), "actorId": None, "payload": {"hackathonId": self.h1, "archivedAt": Clock.iso(timedelta())}}, token=self.org_other), (401, 403))
        r.expect("ideation: round unchanged by rejected sync calls", self.p.call("GET", f"/ideation/{self.h1}", token=self.leader.token), 200, lambda x: x.field("currentRound") == 2)
        if self.sync_secret:
            secret = {"x-sync-secret": self.sync_secret}
            r.expect("sync ideation: valid secret, invalid body 400", self.p.call("PUT", sync, {"currentRound": 9}, headers=secret), 400)
            r.expect("sync ideation: valid secret, unknown hackathon 404", self.p.call("PUT", "/sync/ideation/hack_nope", Ideation.config(2), headers=secret), 404)
            r.expect("sync consume: invalid event 400", self.p.call("POST", "/sync/consume", {"type": "HackathonPublished"}, headers=secret), 400)
            r.expect("sync consume: unknown type 400", self.p.call("POST", "/sync/consume", {"type": "Nope"}, headers=secret), 400)
            r.expect("sync consume-batch: not an array 400", self.p.call("POST", "/sync/consume-batch", {"events": "x"}, headers=secret), 400)
        if not self.ai:
            r.skip("ideation: AI streaming cases", "--no-ai")
            r.expect("organizer ideation: set round 3", self.put_ideation(self.org, self.h1, Ideation.config(3)), 200)
            r.expect("ideation: participant sees round 3", self.wait_round(self.leader, self.h1, 3), 200)
            return
        response, events = self.stream_message(self.leader, self.h1, "personal", "a" * 4000)
        names = [e for e, _ in events]
        r.check("ideation: exactly 4000 chars streams start..done", response.status == 200 and names[:1] == ["start"] and names[-1:] == ["done"], f"status={response.status} events={names[:3]}..{names[-2:]}")
        contents = [f"concurrent-{self.run}-{i}" for i in range(5)]
        started = threading.Semaphore(0)
        results = [None] * 5
        authors = [self.leader, self.mate, self.leader, self.mate, self.leader]

        def send(index):
            results[index] = self.stream_message(authors[index], self.h1, "team", contents[index], lambda e, _p: started.release() if e == "start" else None)

        threads = [threading.Thread(target=send, args=(i,)) for i in range(5)]
        for thread in threads:
            thread.start()
        for _ in range(5):
            started.acquire(timeout=60)
        advanced = self.put_ideation(self.org, self.h1, Ideation.config(3))
        for thread in threads:
            thread.join()
        r.expect("ideation: round advanced while streams in flight", advanced, 200)
        done = [next((p for e, p in evs if e == "done"), None) for _, evs in results]
        r.check("ideation: 5 concurrent team sends all complete", all(d is not None for d in done), f"events={[[e for e, _ in evs] for _, evs in results]}")
        r.check("ideation: in-flight messages tagged with round at send time (2)", all(d and d["round"] == 2 for d in done), f"rounds={[d and d['round'] for d in done]}")
        thread_state = self.wait_round(self.leader, self.h1, 3)
        r.expect("ideation: participant sees round 3 after advance", thread_state, 200)
        team_thread = thread_state.field("teamThread") or []
        mine = [i for i, m in enumerate(team_thread) if m["role"] == "user" and m["content"] in contents]
        r.check("ideation: all 5 team messages persisted once", sorted(team_thread[i]["content"] for i in mine) == sorted(contents), f"found={[team_thread[i]['content'] for i in mine]}")
        r.check("ideation: no interleaving (each user turn followed by its assistant reply)", all(i + 1 < len(team_thread) and team_thread[i + 1]["role"] == "assistant" for i in mine), f"roles={[m['role'] for m in team_thread]}")
        r.check("ideation: persisted messages carry round 2 and author", all(team_thread[i]["round"] == 2 and team_thread[i]["authorId"] in (self.leader.id, self.mate.id) for i in mine), "")
        r.check("ideation: mate sees same team thread", len([m for m in (self.p.call("GET", f"/ideation/{self.h1}", token=self.mate.token).field("teamThread") or []) if m["content"] in contents]) == 5)

    def closure_and_archive_cases(self):
        r = self.report
        r.expect("organizer: confirm without criteria 400", self.o.call("POST", f"/hackathons/{self.no_criteria}/confirm", {}, token=self.org), 400)
        r.expect("organizer: publish from REVIEW 400", self.o.call("POST", f"/hackathons/{self.no_criteria}/publish", {}, token=self.org), 400)
        r.expect("organizer: non-owner publish 403", self.o.call("POST", f"/hackathons/{self.no_criteria}/publish", {}, token=self.org_other), 403)
        r.expect("organizer: transition unknown hackathon 404", self.o.call("POST", "/hackathons/nope/publish", {}, token=self.org), 404)
        r.expect("organizer: participant token on organizer API 401", self.o.call("GET", "/hackathons", token=self.leader.token), 401)
        member, waiting = self.participants(2, register_for=self.h3)
        self.join_code(member, self.h3, self.team_h3)
        if self.sync_secret:
            event = self.o.call("GET", f"/hackathons/{self.h3}/published-event", token=self.org)
            payload = event.field("data") or event.body
            if isinstance(payload, dict) and payload.get("payload"):
                forged = dict(payload)
                forged["eventId"] = "%08x-0000-4000-8000-%012x" % (random.getrandbits(32), random.getrandbits(48))
                forged["payload"] = {**payload["payload"], "registrationEnd": Clock.iso(timedelta(minutes=-5))}
                pushed = self.p.call("POST", "/sync/consume", forged, headers={"x-sync-secret": self.sync_secret})
                r.expect("closure: registration window closed via sync", pushed, (200, 201))
                r.expect("closure: join after registration closed 403", self.join_code(waiting, self.h3, self.team_h3), 403)
                r.expect("closure: create team after registration closed 403", self.create_team(waiting, self.h3, self.unique("Late")), 403)
                r.expect("closure: leave after registration closed 403", self.p.call("POST", f"/team/leave?teamId={self.team_h3['id']}", token=member.token), 403)
                r.expect("closure: delete team after registration closed 403", self.p.call("DELETE", f"/team/{self.team_h3['id']}", token=self.h3_leader.token), 403)
                r.expect("closure: new registration after close 400", self.register(self.participant(), self.h3), 400)
                r.expect("closure: AI helper still works for registered users", self.p.call("GET", f"/ideation/{self.h3}", token=member.token), 200)
            else:
                r.skip("closure cases", f"no published event: {event!r}")
        else:
            r.skip("closure cases", "no --sync-secret")
        r.expect("organizer: archive 200", self.o.call("POST", f"/hackathons/{self.h3}/archive", {}, token=self.org), 200)
        r.expect("organizer: archive twice 400", self.o.call("POST", f"/hackathons/{self.h3}/archive", {}, token=self.org), 400)
        r.expect("organizer: ideation on archived 400", self.put_ideation(self.org, self.h3, Ideation.config(2)), 400)
        archived = self.wait_visible(self.watcher.token, self.h3, lambda x: x.field("status") == "ARCHIVED")
        r.expect("archive: participant sees ARCHIVED", archived, 200, lambda x: x.field("status") == "ARCHIVED")
        r.expect("archive: new registration 400", self.register(self.participant(), self.h3), 400)
        r.expect("archive: create team rejected 403/404", self.create_team(waiting, self.h3, self.unique("Arch")), (403, 404))
        r.expect("archive: join team rejected 403/404", self.join_code(waiting, self.h3, self.team_h3), (403, 404))
        r.expect("archive: AI GET 403", self.p.call("GET", f"/ideation/{self.h3}", token=member.token), 403)
        r.expect("archive: AI POST 403", self.p.call("POST", f"/ideation/{self.h3}/messages", {"scope": "personal", "content": "hi"}, token=member.token), 403)
        r.expect("archive: discovery hides archived", self.p.call("GET", "/hackathons", token=member.token), 200, lambda x: all(h["id"] != self.h3 for h in x.body["data"]))
        r.expect("archive: my hackathons still lists it", self.p.call("GET", "/hackathons/my", token=member.token), 200, lambda x: any(h["id"] == self.h3 for h in x.body["data"]))

    def general_cases(self):
        r = self.report
        token = self.leader.token
        r.expect("general: participant unknown route 404", self.p.call("GET", "/definitely-not-a-route", token=token), 404)
        r.expect("general: organizer unknown route 404", self.o.call("GET", "/definitely-not-a-route", token=self.org), 404)
        for label, api in (("participant", self.p), ("organizer", self.o)):
            r.expect(f"general: {label} malformed JSON 400", api.call("POST", "/auth/login", raw=b'{"email": "a@b.c", '), 400)
            r.expect(f"general: {label} JSON array body 400", api.call("POST", "/auth/login", raw=b"[1,2,3]"), (400, 401))
            r.expect(f"general: {label} empty JSON body 400", api.call("POST", "/auth/login", raw=b""), (400, 401))
            r.expect(f"general: {label} 1.2MB body 413", api.call("POST", "/auth/register", raw=json.dumps({"email": "x@y.z", "fullName": "x" * 1_200_000}).encode()), (400, 413))
        r.expect("general: participant 1.2MB authenticated body 413", self.p.call("POST", f"/ideation/{self.h1}/messages", raw=json.dumps({"scope": "personal", "content": "x" * 1_200_000}).encode(), token=token), (400, 413))
        r.expect("general: participant null body on team create 400", self.p.call("POST", "/team", raw=b"null", token=token), 400)
        r.expect("general: participant health 200", self.p.call("GET", "/health"), 200)
        probes = [
            ("GET", "/team/discover?page=abc&pageSize=-5", None),
            ("GET", f"/team/discover?hackathonId={self.h1}&pageSize=99999&search=%3Cscript%3E", None),
            ("GET", "/hackathons?page=-1&pageSize=100000&status=NOPE", None),
            ("GET", "/hackathons/my?bucket=weird", None),
            ("GET", "/hackathons/nope/phases", None),
            ("GET", "/team/me?hackathonId=nope", None),
            ("POST", "/team/join", {"teamId": "team_nope"}),
            ("POST", "/team/join-requests", {"teamId": "team_nope"}),
            ("POST", "/team/leave", None),
            ("POST", "/team/leave?hackathonId=nope", None),
            ("POST", "/team/invitations/nope/accept", None),
            ("POST", "/team/join-requests/nope/accept", None),
            ("POST", "/team/leave-requests/nope/accept", None),
            ("POST", "/team/leave-requests/nope/cancel", None),
            ("POST", "/team/nope/transfer", {"toUserId": "x"}),
            ("DELETE", "/team/nope", None),
            ("GET", "/notifications", None),
            ("POST", "/notifications/nope/read", None),
            ("POST", "/hackathons/nope/register", None),
            ("POST", f"/hackathons/{self.h1}/register", {"teamChoice": ["x"], "teamId": {"$ne": 1}}),
            ("PUT", "/skill-profile", {"programmingLanguages": "notarray"}),
            ("GET", "/ideation/%00", None),
        ]
        statuses = [self.p.call(method, path, body, token=token).status for method, path, body in probes]
        r.check("general: participant probe sweep returns no 5xx", all(0 < s < 500 for s in statuses), f"statuses={statuses}")

    def run_all(self):
        self.seed()
        self.no_criteria = self.manual_hackathon(self.org, f"NoCriteria {self.run}", Clock.iso(timedelta(days=-1)), Clock.iso(timedelta(days=2)), Clock.iso(timedelta(days=-1)), Clock.iso(timedelta(days=3)), criteria=False, publish=False)
        self.o.call("POST", f"/hackathons/{self.no_criteria}/review", {}, token=self.org)
        for section in (self.auth_cases, self.registration_cases, self.team_cases, self.ideation_cases, self.closure_and_archive_cases, self.general_cases):
            try:
                section()
            except SystemExit:
                raise
            except Exception as error:
                self.report.check(f"{section.__name__} crashed", False, repr(error))
        r = self.report
        print(f"\n{r.passed} passed, {len(r.failed)} failed, {r.skipped} skipped", flush=True)
        for name in r.failed:
            print(f"  FAILED: {name}")
        return 1 if r.failed else 0


def main():
    parser = argparse.ArgumentParser(description="HMT participant/organizer edge-case suite")
    parser.add_argument("participant", nargs="?", default="http://localhost:3000/api/v1")
    parser.add_argument("organizer", nargs="?", default="http://localhost:3002/api/v1")
    parser.add_argument("--origin", default=None)
    parser.add_argument("--sync-secret", default=DEV_SYNC_SECRET, help="x-sync-secret for /sync tests; pass '' to skip")
    parser.add_argument("--no-ai", action="store_true", help="skip cases that send real AI Helper messages")
    sys.exit(EdgeCaseSuite(parser.parse_args()).run_all())


if __name__ == "__main__":
    main()
