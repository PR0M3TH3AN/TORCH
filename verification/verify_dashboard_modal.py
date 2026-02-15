from playwright.sync_api import sync_playwright

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Navigate to dashboard
        print("Navigating to dashboard...")
        page.goto("http://localhost:8081/dashboard/index.html")

        # Click the TORCH link
        print("Clicking TORCH link...")
        page.click("#openDocs")

        # Wait for modal to be visible and content to load
        print("Waiting for modal...")
        page.wait_for_selector("#docsModal.show")

        # Wait for markdown content to be rendered (look for h1)
        page.wait_for_selector("#markdown-content h1")

        # Take screenshot
        print("Taking screenshot...")
        page.screenshot(path="verification/dashboard_modal.png")

        # Verify content
        content = page.inner_text("#markdown-content")
        if "Task Orchestration via Relay-Coordinated Handoff" in content:
            print("SUCCESS: Modal content verified.")
        else:
            print("FAILURE: Modal content not found.")

        browser.close()

if __name__ == "__main__":
    run()
