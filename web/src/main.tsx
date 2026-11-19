import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { config } from "./config";
import App from "./App";
import "./styles.css";
import "./everlight.css";

const qc = new QueryClient({ defaultOptions: { queries: { retry: 2, staleTime: 15_000, refetchOnWindowFocus: false } } });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WagmiProvider config={config} reconnectOnMount>
      <QueryClientProvider client={qc}>
        <App />
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
);
import "./pixel.css";
