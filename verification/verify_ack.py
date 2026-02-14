from playwright.sync_api import sync_playwright, expect

def test_ack_modal():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Grant clipboard permissions
        context = browser.new_context(permissions=["clipboard-read", "clipboard-write"])
        page = context.new_page()

        page.on("console", lambda msg: print(f"Console: {msg.text}"))

        try:
            page.goto("http://localhost:8000/landing/index.html")

            copy_btn = page.locator(".copy-install-btn")
            ack_modal = page.locator("#ackModal")

            # 1. Click Copy
            print("Clicking Copy...")
            copy_btn.click()

            # 2. Verify Modal Appears
            expect(ack_modal).to_be_visible()
            print("Modal appeared.")

            # Verify text is NOT copied yet (button text hasn't changed)
            expect(copy_btn).not_to_have_text("Copied!", timeout=500)
            print("Copy deferred.")

            page.screenshot(path="verification/modal_visible.png")

            # 3. Click Cancel
            cancel_btn = page.locator("#ackModal .btn-cancel")
            cancel_btn.click()

            expect(ack_modal).not_to_be_visible()
            expect(copy_btn).not_to_have_text("Copied!")
            print("Cancelled correctly.")

            # 4. Click Copy Again
            copy_btn.click()
            expect(ack_modal).to_be_visible()

            # 5. Click Confirm
            confirm_btn = page.locator("#ackModal .btn-confirm")
            confirm_btn.click()

            expect(ack_modal).not_to_be_visible()
            expect(copy_btn).to_have_text("Copied!", timeout=2000)
            print("Confirmed and copied.")

            page.screenshot(path="verification/after_ack.png")
            print("Verification successful.")

        except Exception as e:
            print(f"Verification failed: {e}")
            page.screenshot(path="verification/failure.png")
            raise e
        finally:
            browser.close()

if __name__ == "__main__":
    test_ack_modal()
