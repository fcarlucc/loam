import { engineConfigs, engineFrom, remoteEnginesAllowed } from "@/lib/engines";
import type { EngineModels } from "@/lib/types";

// Every engine with its models, for the model picker: offline engines are listed too, with no models.
export async function GET() {
  const engines: EngineModels[] = await Promise.all(
    engineConfigs().map(async (config) => {
      if (config.remote && !remoteEnginesAllowed()) {
        return { ...config, online: false, models: [], error: "Remote engines are off: set ALLOW_REMOTE_ENGINES=1 to use it" };
      }
      try {
        const models = await engineFrom(config).listModels();
        return { ...config, online: true, models: models.map((m) => m.name) };
      } catch (e) {
        return { ...config, online: false, models: [], error: e instanceof Error ? e.message : "Unreachable" };
      }
    }),
  );
  return Response.json({ engines });
}
