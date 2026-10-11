import argparse
import asyncio
import os
import sys
import time
from urllib.parse import urlparse

from playwright.async_api import Page, async_playwright, expect

PARTICIPANT_PAGES = ["Home", "Discover", "My Hackathons", "My Team", "My Project", "AI Helper", "Progress", "Profile"]
ORGANIZER_PAGES = ["Home", "Hackathons", "Participants", "Teams", "Evaluations", "Analytics"]
BROKEN_PAGE_TEXT = ["Something went wrong", "Permission required", "Unexpected Application Error"]


class UiRun:
    def __init__(self, base, email, member, teammate, organizer_email, organizer_password, headed):
        self.base = base.rstrip("/")
        self.email = email
        self.member = member
        self.teammate = teammate
        self.organizer_email = organizer_email
        self.organizer_password = organizer_password
        self.headed = headed
        self.stamp = time.strftime("%H%M%S")
        self.failures = []
        self.passes = 0
        self.expected_errors = set()

    def watch(self, page: Page, who: str):
        def on_response(response):
            path = urlparse(response.url).path
            if response.status < 400 or not path.startswith(("/api/", "/organizer/api/")):
                return
            if (path, response.status) in self.expected_errors or path.endswith(("/auth/me", "/auth/refresh")) and response.status == 401:
                return
            self.failures.append(f"[{who}] HTTP {response.status} {response.request.method} {path}")

        page.on("response", on_response)
        page.on("pageerror", lambda error: self.failures.append(f"[{who}] page error: {error}"))
        page.on("console", lambda msg: msg.type == "error" and "Failed to load resource" not in msg.text and self.failures.append(f"[{who}] console: {msg.text[:200]}"))

    async def step(self, name, action):
        try:
            await action()
            self.passes += 1
            print(f"PASS {name}")
        except Exception as error:
            self.failures.append(f"{name}: {str(error).splitlines()[0][:300]}")
            print(f"FAIL {name}: {str(error).splitlines()[0][:300]}")

    async def assert_page_ok(self, page: Page):
        await page.wait_for_load_state("networkidle")
        for text in BROKEN_PAGE_TEXT:
            if await page.get_by_text(text).count():
                raise AssertionError(f"page shows '{text}' at {page.url}")

    async def participant(self, browser):
        context = await browser.new_context(viewport={"width": 1366, "height": 860})
        page = await context.new_page()
        self.watch(page, "participant")

        async def not_on_list():
            lookup_path = "/api/v1/roster/lookup"
            self.expected_errors.add((lookup_path, 404))
            await page.goto(f"{self.base}/join")
            await page.get_by_test_id("input-roster-email").fill(f"nobody-{self.stamp}@example.com")
            await page.get_by_test_id("button-roster-find").click()
            await expect(page.get_by_test_id("text-roster-error")).to_contain_text("help desk")

        async def enter():
            await page.get_by_test_id("input-roster-email").fill(self.email)
            await page.get_by_test_id("button-roster-find").click()
            await expect(page.get_by_text("Who are you?")).to_be_visible()
            await page.get_by_role("button", name=self.member).first.click()
            await page.wait_for_url("**/participant/ai-helper")
            await expect(page.get_by_test_id("text-sidebar-user")).to_have_text(self.member)

        async def every_page():
            for label in PARTICIPANT_PAGES:
                await page.get_by_test_id(f"link-nav-{label.lower().replace(' ', '-')}").click()
                await self.assert_page_ok(page)

        profile = {"Institution / college / university": f"Test Institute {self.stamp}", "Your city": "Meerut", "Course / department": f"CSE {self.stamp}", "Bio (optional)": f"UI test bio {self.stamp}"}

        async def save_profile():
            await page.goto(f"{self.base}/participant/profile")
            await self.assert_page_ok(page)
            for label, value in profile.items():
                await page.get_by_label(label).fill(value)
            await page.get_by_role("button", name="Save profile").click()
            await expect(page.get_by_text("Profile saved")).to_be_visible()
            await page.reload()
            await self.assert_page_ok(page)
            for label, value in profile.items():
                await expect(page.get_by_label(label)).to_have_value(value)

        project = {"title": f"UI Test Project {self.stamp}", "description": f"Built during UI test {self.stamp}", "problem": f"Problem statement {self.stamp}", "stack": "React, Fastify"}

        async def save_project():
            await page.goto(f"{self.base}/participant/projects")
            await self.assert_page_ok(page)
            editor = page.get_by_role("button", name="Edit project")
            await (editor if await editor.count() else page.get_by_role("button", name="Create project").first).click()
            await page.get_by_placeholder("e.g. Campus food-waste tracker").fill(project["title"])
            await page.get_by_placeholder("What you are building and why now.").fill(project["description"])
            await page.get_by_placeholder("The specific problem and insight behind your build.").fill(project["problem"])
            await page.get_by_placeholder("Next.js, Tailwind, Neo4j, Fastify").fill(project["stack"])
            await page.get_by_role("button", name="Save project").click()
            await expect(page.get_by_text(project["problem"])).to_be_visible()
            await page.reload()
            await self.assert_page_ok(page)
            for value in (project["title"], project["description"], project["problem"], "React"):
                await expect(page.get_by_text(value).first).to_be_visible()

        async def add_milestone():
            title = f"Milestone {self.stamp}"
            await page.get_by_role("button", name="+ Add").click()
            await page.get_by_label("Title").fill(title)
            await page.get_by_label("Description").fill("UI test checkpoint")
            await page.get_by_label("Due date").fill("2026-10-14")
            await page.get_by_role("button", name="Add", exact=True).click()
            await expect(page.get_by_text(title)).to_be_visible()
            await page.reload()
            await expect(page.get_by_text(title)).to_be_visible()

        async def chat_button():
            await page.get_by_test_id("link-project-chat-ai").click()
            await page.wait_for_url("**/participant/ai-helper")
            await self.assert_page_ok(page)

        async def send(scope, text):
            await page.get_by_role("tab", name=scope).click()
            box = page.get_by_label("Message the AI coach")
            await box.fill(text)
            async with page.expect_response(lambda r: r.url.endswith("/messages") and r.request.method == "POST", timeout=120_000) as info:
                await page.get_by_label("Send message").click()
            response = await info.value
            await response.finished()
            await expect(page.get_by_label("Send message")).to_be_attached()
            if response.status != 200:
                raise AssertionError(f"send returned {response.status}")
            body = await response.text()
            if "event: done" not in body:
                raise AssertionError(f"stream did not finish: {body[-300:]}")
            await expect(page.get_by_text(text)).to_be_visible()

        async def team_chat():
            await send("Team", f"UI test {self.stamp}: we think campus navigation is hard for first-year students. What should we check first?")

        async def personal_chat():
            await send("Personal", f"UI test {self.stamp}: privately, how would I find evidence that this problem is real?")

        async def my_team():
            await page.get_by_test_id("link-nav-my-team").click()
            await self.assert_page_ok(page)
            await expect(page.get_by_text(self.member).first).to_be_visible()

        async def discover():
            await page.get_by_test_id("link-nav-discover").click()
            await self.assert_page_ok(page)
            await expect(page.get_by_text("Ideathon 2026").first).to_be_visible()
            await page.get_by_text("Ideathon 2026").first.click()
            await self.assert_page_ok(page)

        async def my_hackathons():
            await page.get_by_test_id("link-nav-my-hackathons").click()
            await self.assert_page_ok(page)
            await expect(page.get_by_text("Ideathon 2026").first).to_be_visible()

        async def inbox():
            await page.get_by_test_id("button-notifications").click()
            await expect(page.get_by_text("Inbox")).to_be_visible()
            await page.get_by_test_id("button-close-inbox").click()

        async def mobile_sidebar():
            await page.set_viewport_size({"width": 390, "height": 664})
            await page.get_by_test_id("button-open-menu").click()
            logout = page.get_by_test_id("button-logout")
            await logout.scroll_into_view_if_needed()
            box = await logout.bounding_box()
            if not box or box["y"] + box["height"] > 664:
                raise AssertionError(f"logout not fully visible on mobile: {box}")
            await page.get_by_test_id("button-close-menu").click()
            await page.set_viewport_size({"width": 1366, "height": 860})

        async def logout():
            await page.get_by_test_id("button-logout").click()
            await page.wait_for_url("**/login")

        for name, action in [
            ("join: email not on list shows help desk", not_on_list),
            ("join: lead email -> pick name -> AI Helper", enter),
            ("nav: every participant page loads", every_page),
            ("profile: save and persists after reload", save_profile),
            ("project: save incl. problem statement, persists", save_project),
            ("project: add milestone, persists", add_milestone),
            ("project: Chat with AI button opens AI Helper", chat_button),
            ("ai: team message streams a reply", team_chat),
            ("ai: personal message streams a reply", personal_chat),
            ("team: My Team shows the member", my_team),
            ("discover: Ideathon 2026 listed and opens", discover),
            ("my hackathons: Ideathon 2026 listed", my_hackathons),
            ("inbox: opens and closes", inbox),
            ("mobile: sidebar logout fully visible", mobile_sidebar),
            ("logout: back to login", logout),
        ]:
            await self.step(name, action)
        await context.close()

    async def teammate_view(self, browser):
        if not self.teammate:
            return
        context = await browser.new_context(viewport={"width": 1366, "height": 860})
        page = await context.new_page()
        self.watch(page, "teammate")

        async def enter():
            await page.goto(f"{self.base}/join")
            await page.get_by_test_id("input-roster-email").fill(self.email)
            await page.get_by_test_id("button-roster-find").click()
            await page.get_by_role("button", name=self.teammate).first.click()
            await page.wait_for_url("**/participant/ai-helper")

        async def shared_team_thread():
            await page.get_by_role("tab", name="Team").click()
            await expect(page.get_by_text(f"UI test {self.stamp}: we think campus navigation").first).to_be_visible()

        async def private_personal_thread():
            await page.get_by_role("tab", name="Personal").click()
            await page.wait_for_timeout(1000)
            if await page.get_by_text(f"UI test {self.stamp}: privately").count():
                raise AssertionError("teammate can see another member's personal thread")

        async def shared_project():
            await page.get_by_test_id("link-nav-my-project").click()
            await self.assert_page_ok(page)
            await expect(page.get_by_text(f"Problem statement {self.stamp}")).to_be_visible()
            await expect(page.get_by_text(f"Milestone {self.stamp}")).to_be_visible()

        for name, action in [
            ("teammate: enters the same team", enter),
            ("teammate: sees the shared team thread", shared_team_thread),
            ("teammate: cannot see the other member's personal thread", private_personal_thread),
            ("teammate: sees the same project and milestone", shared_project),
        ]:
            await self.step(name, action)
        await context.close()

    async def organizer(self, browser):
        if not self.organizer_password:
            print("SKIP organizer: ORGANIZER_PASSWORD not set")
            return
        context = await browser.new_context(viewport={"width": 1366, "height": 860})
        page = await context.new_page()
        self.watch(page, "organizer")

        async def login():
            await page.goto(f"{self.base}/login")
            await page.get_by_test_id("button-auth-role-organizer").click()
            await page.get_by_test_id("input-auth-email").fill(self.organizer_email)
            await page.get_by_test_id("input-auth-password").fill(self.organizer_password)
            await page.get_by_test_id("button-submit-login").click()
            await page.wait_for_url("**/organizer/dashboard")

        async def every_page():
            for label in ORGANIZER_PAGES:
                await page.get_by_test_id(f"link-nav-{label.lower()}").click()
                await self.assert_page_ok(page)

        async def hackathon_detail():
            await page.get_by_test_id("link-nav-hackathons").click()
            await self.assert_page_ok(page)
            await page.get_by_text("Ideathon 2026").first.click()
            await self.assert_page_ok(page)
            for tab in await page.get_by_role("tab").all() or await page.locator("[data-testid^='tab-']").all():
                await tab.click()
                await self.assert_page_ok(page)

        for name, action in [
            ("organizer: login", login),
            ("organizer: every page loads", every_page),
            ("organizer: hackathon detail and tabs load", hackathon_detail),
        ]:
            await self.step(name, action)
        await context.close()

    async def run(self):
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=not self.headed, slow_mo=150 if self.headed else 0)
            await self.participant(browser)
            await self.teammate_view(browser)
            await self.organizer(browser)
            await browser.close()
        print(f"\n{self.passes} passed, {len(self.failures)} problems")
        for failure in self.failures:
            print(" -", failure)
        return 1 if self.failures else 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("base")
    parser.add_argument("--email", required=True)
    parser.add_argument("--member", required=True)
    parser.add_argument("--teammate")
    parser.add_argument("--organizer-email", default="organizer@ideathon2026.in")
    parser.add_argument("--headed", action="store_true")
    args = parser.parse_args()
    run = UiRun(args.base, args.email, args.member, args.teammate, args.organizer_email, os.environ.get("ORGANIZER_PASSWORD"), args.headed)
    sys.exit(asyncio.run(run.run()))
