from playwright.sync_api import sync_playwright

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto("http://localhost:8080/landing/index.html")

    # Wait for the page to load
    page.wait_for_selector(".agent-selector")

    # 1. Verify default state (Jules selected)
    jules_card = page.locator("#card-jules")
    codex_card = page.locator("#card-codex")

    print("Checking default state...")
    assert jules_card.get_attribute("aria-checked") == "true", "Jules card should be checked by default"
    assert codex_card.get_attribute("aria-checked") == "false", "Codex card should not be checked by default"

    # 2. Test keyboard navigation and selection
    print("Testing keyboard interaction...")
    # Focus on the first card (Jules) - assume tab order is correct
    jules_card.focus()

    # Tab to Codex
    page.keyboard.press("Tab")
    # Verify focus is on Codex (simulated by checking active element or just pressing Enter)
    # Actually, pressing Tab from Jules should go to Codex if tabindex="0" on both.

    # Press Enter to select Codex
    page.keyboard.press("Enter")

    # Verify Codex is selected
    assert codex_card.get_attribute("aria-checked") == "true", "Codex card should be checked after Enter"
    assert jules_card.get_attribute("aria-checked") == "false", "Jules card should be unchecked after selection change"

    # 3. Take screenshot
    print("Taking screenshot...")
    page.screenshot(path="verification.png")

    browser.close()

with sync_playwright() as playwright:
    run(playwright)
