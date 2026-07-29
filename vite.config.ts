import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The provider is loaded by D365 inside an iframe and itself frames the
// Amazon Connect CCP. Do not emit X-Frame-Options; framing is controlled via
// Content-Security-Policy frame-ancestors in staticwebapp.config.json.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Local HTTPS is required for D365 to embed the provider and for Connect
    // softphone. Use `mkcert` or a tunnel (e.g. dev tunnels) during dev.
  },
});
