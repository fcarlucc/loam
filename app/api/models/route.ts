import { engineConfigs, engineFrom, remoteEnginesAllowed } from "@/lib/engines";
import type { EngineModels } from "@/lib/types";

// Every engine with its models, for the model picker: offline engines are listed too, with no models.
export async function GET() {
  const engines: EngineModels[] = await Promise.all(
    engineConfigs().map(async (config) => {
      const engine = engineFrom(config);
      const { supports } = engine;
      if (config.remote && !remoteEnginesAllowed()) {
        return { ...config, supports, online: false, models: [], error: "Remote engines are off: set ALLOW_REMOTE_ENGINES=1 to use it" };
      }
      try {
        const models = await engine.listModels();
        return { ...config, supports, online: true, models: models.map((m) => m.name) };
      } catch (e) {
        return { ...config, supports, online: false, models: [], error: e instanceof Error ? e.message : "Unreachable" };
      }
    }),
  );
  return Response.json({ engines });
}
