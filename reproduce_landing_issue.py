
from playwright.sync_api import sync_playwright

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto("http://localhost:3000/landing/index.html")

    # Simulate scrolling down
    page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
    page.wait_for_timeout(2000) # Wait for transitions

    # Take screenshot of the entire page
    page.screenshot(path="landing_page_scrolled.png", full_page=True)

    browser.close()

with sync_playwright() as playwright:
    run(playwright)
