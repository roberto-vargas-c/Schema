import { ClipboardList, Layers, LayoutGrid, Library, MapPinned, Network, Palette, type LucideIcon } from "lucide-react";

/** The board's plug-ins: tools for architects that open in a panel of their own from the Plug-ins button. */
export type PluginId = "bubbles" | "rooms" | "trace" | "site" | "materials" | "crit" | "precedents";

export const PLUGINS: { id: PluginId; name: string; description: string; icon: LucideIcon }[] = [
  {
    id: "bubbles", name: "Bubble diagram", icon: Network,
    description: "Rooms from a program as bubbles sized to their area, linked by how they relate, downloaded for Keystone's massing.",
  },
  {
    id: "rooms", name: "Room schedule", icon: ClipboardList,
    description: "Name measured rooms and keep a schedule of their areas, checked against the brief.",
  },
  {
    id: "trace", name: "Tracing paper", icon: Layers,
    description: "Lay plan versions over each other in colored lines, fade between them, or sketch on a sheet of trace.",
  },
  {
    id: "site", name: "Site analysis", icon: MapPinned,
    description: "A scaled site map, the sun path, a north arrow and the sun's angles through the year, for any address.",
  },
  {
    id: "materials", name: "Material board", icon: Palette,
    description: "Swatches with finish, supplier and cost, tags that place them on plans, and a finishes schedule.",
  },
  {
    id: "crit", name: "Crit wall", icon: LayoutGrid,
    description: "Pin sheets up as a wall, stamp them approved, revise or question, and keep a decision log.",
  },
  {
    id: "precedents", name: "Precedents", icon: Library,
    description: "Clip reference pictures with their source, credit and tags, and arrange them by theme.",
  },
];
