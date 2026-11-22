import { Layers, MapPinned, type LucideIcon } from "lucide-react";

/** The board's plug-ins: tools for architects that open in a panel of their own from the Plug-ins button. */
export type PluginId = "trace" | "site";

export const PLUGINS: { id: PluginId; name: string; description: string; icon: LucideIcon }[] = [
  {
    id: "trace", name: "Tracing paper", icon: Layers,
    description: "Lay plan versions over each other in colored lines, fade between them, or sketch on a sheet of trace.",
  },
  {
    id: "site", name: "Site analysis", icon: MapPinned,
    description: "A scaled site map, the sun path, a north arrow and the sun's angles through the year, for any address.",
  },
];
