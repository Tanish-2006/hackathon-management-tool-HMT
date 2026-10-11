import json
import os
import secrets
import sys
from datetime import datetime, timezone

from smoke import Api

EVENT = {
    "title": "Ideathon 2026",
    "description": "Shortlisted teams shape their idea with the AI Helper, from problem to pitch, and present it offline in their PPT round slot.",
    "hackathonType": "OPEN_INNOVATION",
    "mode": "OFFLINE",
    "audience": "Shortlisted student teams",
    "duration": "12-15 Oct 2026",
    "teamSize": {"min": 1, "max": 4},
    "registrationStart": "2026-09-28T00:00:00Z",
    "eventStart": "2026-10-12T03:30:00Z",
    "eventEnd": "2026-10-15T12:30:00Z",
}
CRITERIA = [
    ("Problem clarity", "Is the problem real, specific and backed by evidence?", 0.25),
    ("Originality", "How the idea differs from what already exists", 0.25),
    ("Feasibility", "Can the team realistically build and run it?", 0.25),
    ("Pitch", "Clarity and honesty of the deck and presentation", 0.25),
]


class IdeathonSetup:
    def __init__(self, base, roster_path):
        self.api = Api(base, base)
        self.roster = json.load(open(roster_path, encoding="utf-8"))
        self.sync_secret = os.environ["SYNC_SHARED_SECRET"]

    def expect(self, label, status, body, ok=(200, 201)):
        if status not in ok:
            sys.exit(f"{label} failed: {status} {body}")
        return body.get("data", body) if isinstance(body, dict) else body

    def organizer(self, email):
        password = os.environ.get("ORGANIZER_PASSWORD") or secrets.token_urlsafe(12)
        status, body = self.api.call("POST", "/organizer/api/v1/auth/register", {
            "email": email, "password": password, "fullName": "Ideathon Organizer",
            "displayName": "Ideathon Organizer", "role": "ORGANIZER", "phoneNumber": "+919999900001",
        })
        if status == 409:
            status, body = self.api.call("POST", "/organizer/api/v1/auth/login", {"email": email, "password": password})
        return self.expect("organizer account", status, body)["accessToken"], password

    def publish(self, token):
        existing = self.expect("list hackathons", *self.api.call("GET", "/organizer/api/v1/hackathons", token=token))
        hackathon = next((h for h in existing if h["title"] == EVENT["title"]), None)
        if not hackathon:
            closed_now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            hackathon = self.expect("create hackathon", *self.api.call(
                "POST", "/organizer/api/v1/hackathons", {**EVENT, "registrationEnd": closed_now}, token))
        hid = hackathon["id"]
        criteria = self.expect("list criteria", *self.api.call("GET", f"/organizer/api/v1/hackathons/{hid}/evaluation-criteria", token=token))
        for name, description, weight in CRITERIA if not criteria else []:
            self.expect(f"criterion {name}", *self.api.call("POST", f"/organizer/api/v1/hackathons/{hid}/evaluation-criteria",
                {"name": name, "description": description, "weight": weight, "maxScore": 10}, token))
        steps = {"DRAFT": ("review", "confirm", "publish"), "REVIEW": ("confirm", "publish"), "CONFIRMED": ("publish",)}
        for step in steps.get(hackathon.get("status"), ()):
            self.expect(step, *self.api.call("POST", f"/organizer/api/v1/hackathons/{hid}/{step}", {}, token))
        return hid

    def import_roster(self, hackathon_id):
        return self.expect("roster import", *self.api.call(
            "PUT", f"/api/v1/roster/{hackathon_id}", self.roster, headers={"x-sync-secret": self.sync_secret}))


if __name__ == "__main__":
    base, roster_path, organizer_email = sys.argv[1:4]
    setup = IdeathonSetup(base, roster_path)
    token, password = setup.organizer(organizer_email)
    hackathon_id = setup.publish(token)
    print("hackathon", hackathon_id)
    print("roster", setup.import_roster(hackathon_id))
    print("organizer", organizer_email, password)
