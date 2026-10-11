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
        password = secrets.token_urlsafe(12)
        body = self.expect("organizer signup", *self.api.call("POST", "/organizer/api/v1/auth/register", {
            "email": email, "password": password, "fullName": "Ideathon Organizer",
            "displayName": "Ideathon Organizer", "role": "ORGANIZER", "phoneNumber": "+919999900001",
        }))
        return body["accessToken"], password

    def publish(self, token):
        closed_now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        hackathon = self.expect("create hackathon", *self.api.call(
            "POST", "/organizer/api/v1/hackathons", {**EVENT, "registrationEnd": closed_now}, token))
        for step in ("review", "confirm", "publish"):
            self.expect(step, *self.api.call("POST", f"/organizer/api/v1/hackathons/{hackathon['id']}/{step}", {}, token))
        return hackathon["id"]

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
