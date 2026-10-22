import { configurationError, supabase } from "../data/supabaseClient.js";

export function renderLogin(container, { onSubmit }) {
  container.innerHTML = `
    <section class="login-page">
      <form class="login-card" id="login-form">
        <h1 class="brand">Pathway Admin</h1>
        <p class="lead">Sign in to manage membership and working hours.</p>
        <label class="field" for="username">
          Username
          <input id="username" name="username" autocomplete="username" required autofocus />
        </label>
        <label class="field" for="password">
          Password
          <input id="password" name="password" type="password" autocomplete="current-password" required />
        </label>
        <button class="button" type="submit">Sign in</button>
        <p class="message" id="login-message" role="alert"></p>
      </form>
    </section>
  `;

  const form = container.querySelector("#login-form");
  const button = form.querySelector("button");
  const message = container.querySelector("#login-message");

  if (!supabase) {
    message.textContent = configurationError;
    message.dataset.kind = "info";
    button.disabled = true;
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.textContent = "";
    button.disabled = true;

    try {
      const values = new FormData(form);
      await onSubmit(values.get("username"), values.get("password"));
    } catch (error) {
      message.textContent = error instanceof Error
        ? error.message
        : "Unable to sign in.";
    } finally {
      button.disabled = false;
    }
  });
}
