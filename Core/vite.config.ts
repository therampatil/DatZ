import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    build: {
      outDir: "web-dist",
      emptyOutDir: true,
      target: "es2022",
      sourcemap: false,
    },
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(env.SUPABASE_URL || env.VITE_SUPABASE_URL || ""),
      "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(
        env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || ""
      ),
    },
  };
});
