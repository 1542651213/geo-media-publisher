import React from "react";
import { createRoot } from "react-dom/client";
import "./design/tokens.css";
import { App } from "./App";
import "./styles.css";
import "./design/workspace-layout.css";
import "./platform-connection.css";
import "./design/components.css";

createRoot(document.getElementById("root") as HTMLElement).render(<React.StrictMode><App /></React.StrictMode>);
