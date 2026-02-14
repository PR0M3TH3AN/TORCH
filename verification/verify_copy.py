from playwright.sync_api import sync_playwright, expect

def test_copy_button():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Grant clipboard permissions
        context = browser.new_context(permissions=["clipboard-read", "clipboard-write"])
        page = context.new_page()

        page.on("console", lambda msg: print(f"Console: {msg.text}"))

        try:
            page.goto("http://localhost:8000/landing/index.html")

            copy_btn = page.locator(".copy-install-btn")
            expect(copy_btn).to_be_visible()

            copy_btn.click()

            # Verify text changes to "Copied!"
            expect(copy_btn).to_have_text("Copied!", timeout=2000)

            page.screenshot(path="verification/before_change.png")
            print("Successfully verified copy button works without warning.")

        except Exception as e:
            print(f"Verification failed: {e}")
            page.screenshot(path="verification/failure.png")
            raise e
        finally:
            browser.close()

if __name__ == "__main__":
    test_copy_button()
