import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../../src/ui/style.css";
import { Shell } from "../../src/ui/Shell.jsx";

const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <StrictMode>
      <Shell />
    </StrictMode>,
  );
