
from playwright.sync_api import sync_playwright

def verify_dashboard():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            page.goto("http://localhost:4173/dashboard/")
            # Wait for title
            page.wait_for_selector("h1:has-text('TORCH Agent Dashboard')")
            # Wait a bit for JS to run and potentially render the summary bar
            page.wait_for_timeout(3000)

            # Take screenshot
            page.screenshot(path="verification/dashboard.png")
            print("Screenshot saved to verification/dashboard.png")
        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_dashboard()
