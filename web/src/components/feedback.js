import { submitFeedback, track } from "../lib/analytics.js";
import { walletState } from "../lib/wallet.js";
import { toast } from "./toast.js";

const SEEN_KEY = "kirim:feedback-sent";

function alreadySent() {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function markSent() {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // abaikan
  }
}

/// Lembar masukan — wajib untuk validasi produk, dan rekapnya muncul di /monitor.
export function openFeedback() {
  track("feedback_opened");

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-label="Send feedback">
      <h2 style="margin-bottom:6px">How was it?</h2>
      <p class="muted small" style="margin:0 0 14px">
        One tap helps us shape KIRIM. Nothing identifying is stored.
      </p>
      <form id="fb-form">
        <div class="rating" id="fb-rating">
          ${[1, 2, 3, 4, 5]
            .map(
              (n) =>
                `<button type="button" data-score="${n}" aria-pressed="false" aria-label="${n} out of 5">${
                  ["😖", "🙁", "😐", "🙂", "🤩"][n - 1]
                }</button>`
            )
            .join("")}
        </div>
        <label>
          <span>Who are you?</span>
          <select id="fb-role">
            <option value="">Prefer not to say</option>
            <option value="sender">I sent money</option>
            <option value="recipient">I claimed a link</option>
            <option value="builder">Developer / builder</option>
            <option value="student">Student</option>
          </select>
        </label>
        <label>
          <span>What worked, what didn't?</span>
          <textarea id="fb-comment" maxlength="500" placeholder="The claim link was easy to open, but…"></textarea>
        </label>
        <button class="block" type="submit">Send feedback</button>
        <button class="ghost block" type="button" id="fb-close">Maybe later</button>
        <p class="status" id="fb-status"></p>
      </form>
    </div>
  `;

  const close = () => backdrop.remove();
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) close();
  });
  backdrop.querySelector("#fb-close").addEventListener("click", close);

  let rating = 0;
  backdrop.querySelectorAll("#fb-rating button").forEach((button) => {
    button.addEventListener("click", () => {
      rating = Number(button.dataset.score);
      backdrop.querySelectorAll("#fb-rating button").forEach((other) => {
        other.setAttribute("aria-pressed", String(other === button));
      });
    });
  });

  backdrop.querySelector("#fb-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = backdrop.querySelector("#fb-status");
    if (!rating) {
      status.className = "status error";
      status.textContent = "Pick a face first 🙂";
      return;
    }

    const button = event.target.querySelector("button[type=submit]");
    button.disabled = true;
    status.className = "status working";
    status.innerHTML = `<span class="spinner"></span>Sending…`;

    try {
      await submitFeedback({
        rating,
        comment: backdrop.querySelector("#fb-comment").value.trim(),
        role: backdrop.querySelector("#fb-role").value,
        wallet: walletState().address ?? "",
      });
      track("feedback_submitted", { rating });
      markSent();
      close();
      toast("Thank you — that shapes what we build next. 🧧", "ok");
    } catch (error) {
      status.className = "status error";
      status.textContent = "Couldn't send that. Try again in a moment.";
      button.disabled = false;
    }
  });

  document.body.appendChild(backdrop);
}

export function mountFeedbackButton() {
  const button = document.createElement("button");
  button.className = "fab ghost";
  button.textContent = "💬 Feedback";
  button.addEventListener("click", openFeedback);
  document.body.appendChild(button);
}

/// Setelah transaksi pertama yang berhasil, tanyakan sekali — jangan mengganggu lagi.
export function maybeAskForFeedback() {
  if (alreadySent()) return;
  setTimeout(openFeedback, 2_600);
}
