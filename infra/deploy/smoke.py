import json
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone


class Api:
    def __init__(self, base, origin):
        self.base = base.rstrip("/")
        self.origin = origin

    def call(self, method, path, body=None, token=None, raw=False):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method)
        req.add_header("Content-Type", "application/json")
        req.add_header("Origin", self.origin)
        if token:
            req.add_header("Authorization", f"Bearer {token}")
        try:
            with urllib.request.urlopen(req, timeout=120) as res:
                text = res.read().decode()
                return res.status, text if raw else (json.loads(text) if text else None)
        except urllib.error.HTTPError as err:
            text = err.read().decode()
            try:
                return err.code, json.loads(text)
            except ValueError:
                return err.code, text


class Smoke:
    def __init__(self, base, phase, origin):
        self.api = Api(base, origin)
        self.phase = phase
        self.stamp = str(int(time.time()))
        self.failures = 0
        self.state_file = "/tmp/hmt-smoke-state.json"

    def check(self, label, condition, detail=""):
        print(("PASS " if condition else "FAIL ") + label + ("" if condition else f"  -> {detail}"))
        if not condition:
            self.failures += 1
        return condition

    def data(self, payload):
        return payload.get("data", payload) if isinstance(payload, dict) else payload

    def organizer(self):
        email = f"org{self.stamp}@smoke.hmt"
        status, body = self.api.call("POST", "/organizer/api/v1/auth/register", {
            "email": email, "password": "Str0ngPass123!", "displayName": "Smoke Org",
            "fullName": "Smoke Org", "role": "ORGANIZER", "phoneNumber": f"+1415{self.stamp[-7:]}",
        })
        self.check("organizer signup", status in (200, 201), body)
        return body["accessToken"]

    def publish_ideathon(self, org):
        status, body = self.api.call("POST", "/organizer/api/v1/hackathons/wizard/generate", {
            "mode": "HYBRID", "about": f"Smoke Ideathon {self.stamp}: incubate campus ideas",
            "hackathonType": "OPEN_INNOVATION", "eligibility": ["Students"],
            "durationPlus": "3 days\nIdeation only\nPrizes: best idea",
        }, org)
        self.check("create hackathon via wizard", status in (200, 201), body)
        hid = self.data(body)["hackathon"]["id"]
        start = datetime.now(timezone.utc) + timedelta(days=1)
        status, body = self.api.call("POST", f"/organizer/api/v1/hackathons/{hid}/timeline/materialize", {
            "eventStart": start.isoformat().replace("+00:00", "Z"),
            "eventEnd": (start + timedelta(days=2)).isoformat().replace("+00:00", "Z"),
        }, org)
        self.check("materialize timeline", status in (200, 201), body)
        for step in ("review", "confirm", "publish"):
            status, body = self.api.call("POST", f"/organizer/api/v1/hackathons/{hid}/{step}", {}, org)
            self.check(f"hackathon {step}", status in (200, 201), body)
        return hid

    def set_round(self, org, hid, round_number):
        status, body = self.api.call("GET", f"/organizer/api/v1/hackathons/{hid}/ideation", token=org)
        config = self.data(body)
        config["currentRound"] = round_number
        status, body = self.api.call("PUT", f"/organizer/api/v1/hackathons/{hid}/ideation", config, org)
        self.check(f"organizer sets round {round_number}", status == 200, body)

    def participant(self, name, index):
        email = f"p{index}-{self.stamp}@smoke.hmt"
        status, body = self.api.call("POST", "/api/v1/auth/register", {
            "fullName": name, "email": email, "password": "Str0ngPass123!",
            "phoneNumber": f"+1650{self.stamp[-6:]}{index}",
        })
        self.check(f"{name} signup without OTP", status in (200, 201) and body.get("phoneVerificationRequired") is False, body)
        token = body["accessToken"]
        status, body = self.api.call("PUT", "/api/v1/skill-profile", {
            "programmingLanguages": ["Python"], "frameworks": ["React"], "experienceLevel": "INTERMEDIATE",
        }, token)
        self.check(f"{name} skill profile", status in (200, 201), body)
        return token

    def register(self, token, hid, name):
        self.api.call("POST", "/api/v1/sync/pull", {}, token)
        status, body = self.api.call("POST", f"/api/v1/hackathons/{hid}/register", {
            "teamChoice": "later", "eligibilityAccepted": True,
        }, token)
        self.check(f"{name} registers for ideathon", status in (200, 201), body)

    def stream(self, token, hid, scope, content):
        status, text = self.api.call("POST", f"/api/v1/ideation/{hid}/messages", {"scope": scope, "content": content}, token, raw=True)
        ok = status in (200, 201) and "event: done" in text and "event: delta" in text
        self.check(f"ideation {scope} message streams", ok, f"{status} {str(text)[:300]}")
        deltas = [json.loads(line[6:]).get("text", "") for line in str(text).splitlines() if line.startswith("data: ") and '"text"' in line]
        print("     reply preview:", "".join(deltas)[:160].replace("\n", " "))

    def run_flow(self):
        org = self.organizer()
        hid = self.publish_ideathon(org)
        self.set_round(org, hid, 1)
        p1 = self.participant("Asha", 1)
        p2 = self.participant("Bilal", 2)
        p3 = self.participant("Chen", 3)
        for token, name in ((p1, "Asha"), (p2, "Bilal"), (p3, "Chen")):
            self.register(token, hid, name)
        status, team = self.api.call("POST", "/api/v1/team", {"name": f"Smokers {self.stamp}", "hackathonId": hid, "maxMembers": 4}, p1)
        team = self.data(team)
        self.check("Asha creates team", status in (200, 201) and bool(team.get("inviteCode")), team)
        status, body = self.api.call("POST", "/api/v1/team/join-by-code", {"teamName": team["name"], "tid": team["inviteCode"], "hackathonId": hid}, p2)
        self.check("Bilal joins instantly by code", status in (200, 201) and self.data(body).get("status") == "JOINED", body)
        status, body = self.api.call("POST", "/api/v1/team/join-by-code", {"teamName": team["name"], "tid": "HMT-ZZZZZZ", "hackathonId": hid}, p3)
        self.check("Chen rejected with wrong code", status == 404, body)
        status, body = self.api.call("GET", f"/api/v1/team/{team['id']}", token=p2)
        self.check("team detail for member", status == 200 and len(self.data(body).get("members", [])) == 2, body)
        self.stream(p1, hid, "team", "We want to help college students find affordable shared housing.")
        self.stream(p3, hid, "personal", "I have a rough idea about reducing food waste in hostels.")
        self.set_round(org, hid, 2)
        status, body = self.api.call("GET", f"/api/v1/ideation/{hid}", token=p2)
        view = self.data(body)
        self.check("participant sees round 2", status == 200 and view.get("currentRound") == 2, body)
        self.check("team thread visible to teammate", len(view.get("teamThread") or []) >= 1, view.get("teamThread"))
        with open(self.state_file, "w") as fh:
            json.dump({"hid": hid, "team": team["id"], "p2": p2, "org": org}, fh)

    def run_verify(self):
        with open(self.state_file) as fh:
            state = json.load(fh)
        status, body = self.api.call("GET", f"/api/v1/ideation/{state['hid']}", token=state["p2"])
        view = self.data(body)
        self.check("after restart: round persisted", status == 200 and view.get("currentRound") == 2, body)
        self.check("after restart: team thread persisted", len(view.get("teamThread") or []) >= 1, body)
        status, body = self.api.call("GET", f"/api/v1/team/{state['team']}", token=state["p2"])
        self.check("after restart: team persisted", status == 200 and len(self.data(body).get("members", [])) == 2, body)
        status, body = self.api.call("GET", f"/organizer/api/v1/hackathons/{state['hid']}/ideation", token=state["org"])
        self.check("after restart: organizer state persisted", status == 200, body)

    def main(self):
        self.run_verify() if self.phase == "verify" else self.run_flow()
        print(f"\n{self.failures} failure(s)")
        sys.exit(1 if self.failures else 0)


if __name__ == "__main__":
    args = sys.argv[1:] + [None, None, None]
    Smoke(args[0] or "http://127.0.0.1", args[1] or "flow", args[2] or "http://68.221.114.148").main()
