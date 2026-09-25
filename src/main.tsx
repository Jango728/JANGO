import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./globals.css";
import "./jango.css";
import "./headshot.css";
import "./champions.css";
import App from "./App";

// Black & gold is the house look: dark unless this viewer switched to light before.
try {
  const saved = localStorage.getItem("fightlens-theme-v2");
  document.documentElement.classList.toggle("dark", saved !== "light");
} catch {
  document.documentElement.classList.add("dark");
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
