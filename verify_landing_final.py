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
    # Focus on the first card (Jules)
    jules_card.focus()

    # Tab to link inside Jules card
    page.keyboard.press("Tab")

    # Tab to Codex card
    page.keyboard.press("Tab")

    # Check if focused element is Codex card
    focused_id = page.evaluate("document.activeElement.id")
    assert focused_id == "card-codex", f"Expected focus on card-codex, but got {focused_id}"

    # Press Enter to select Codex
    page.keyboard.press("Enter")

    # Verify Codex is selected
    assert codex_card.get_attribute("aria-checked") == "true", "Codex card should be checked after Enter"
    assert jules_card.get_attribute("aria-checked") == "false", "Jules card should be unchecked after selection change"

    # 3. Take screenshot
    print("Taking screenshot...")
    page.screenshot(path="verification.png")

    browser.close()

if __name__ == "__main__":
    with sync_playwright() as playwright:
        run(playwright)
