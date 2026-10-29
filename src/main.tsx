import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/geist-sans/400.css";
import "@fontsource/geist-sans/500.css";
import "@fontsource/geist-sans/600.css";
import "@fontsource/geist-mono/400.css";
import "./ui/tokens.css";
import "./ui/base.css";
import { App } from "./app/App";
import { initSim } from "./sim/engine";
import { startSimulation } from "./sim/store";

initSim()
  .then(startSimulation)
  .catch((err) => console.error("Simulador não carregou:", err));

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
