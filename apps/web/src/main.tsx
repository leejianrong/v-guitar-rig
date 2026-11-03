import "@fontsource/big-shoulders-display/800";
import "@fontsource/ibm-plex-mono/400";
import "@fontsource/ibm-plex-sans/400";
import "@fontsource/ibm-plex-sans/600";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
